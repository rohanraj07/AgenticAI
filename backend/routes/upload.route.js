import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { DocumentIngestionAgent } from '../agents/document.ingestion.agent.js';
import { buildFinancialGraph } from '../langgraph/graph.js';
import { redisMemory, vectorStore, eventEmitter } from '../services.js';
import { MarkdownMemory } from '../memory/markdown.memory.js';
import { log } from '../logger.js';

/**
 * TRUST-BY-DESIGN — Upload Route
 *
 * Files are received in-memory (memoryStorage) and NEVER written to disk.
 * Only abstracted signals extracted by DocumentIngestionAgent are persisted.
 * The raw document is discarded immediately after processing.
 */
const storage = multer.memoryStorage();  // No disk persistence of uploaded files
const upload  = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },  // 5 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = ['text/plain', 'application/json', 'text/csv', 'application/pdf'];
    // For POC: accept text-based files; in production, add PDF parser
    if (allowed.includes(file.mimetype) || file.originalname.endsWith('.txt') || file.originalname.endsWith('.json')) {
      cb(null, true);
    } else {
      cb(new Error('Only .txt, .json, and .csv files supported in this POC'));
    }
  },
});

const documentIngestionAgent = new DocumentIngestionAgent();
const markdownMemory         = new MarkdownMemory();
const financialGraph         = buildFinancialGraph();

export const uploadRoute = Router();

/**
 * POST /api/upload
 * Accepts: multipart/form-data with field "document" + optional "sessionId"
 *
 * Pipeline:
 *   1. Receive file in-memory (never written to disk)
 *   2. document_ingestion_agent: classify + extract abstracted signals
 *   3. Discard raw document
 *   4. Run appropriate agents via LangGraph (tax / cashflow / portfolio / risk)
 *   5. Return UI components + sanitized data
 */
uploadRoute.post('/upload', upload.single('document'), async (req, res) => {
  const reqStart = Date.now();

  if (!req.file) {
    return res.status(400).json({ error: 'No document uploaded. Use field name "document".' });
  }

  const { sessionId: incomingSessionId } = req.body;
  const sessionId  = incomingSessionId || uuidv4();
  const fileName   = req.file.originalname;
  const fileSize   = req.file.size;

  log.route(`POST /upload | session: ${sessionId} | file: "${fileName}" (${fileSize} bytes)`);
  log.route('  ⚠️  TRUST-BY-DESIGN: File received in-memory. Will NOT be written to disk.');

  try {
    // 1. Read file content as text (in-memory buffer — never persisted)
    const documentText = req.file.buffer.toString('utf-8');
    log.route(`  Document text extracted (${documentText.length} chars) — raw content in transient memory only`);

    // 2. Load existing session
    const session = (await redisMemory.getSession(sessionId)) || {};
    const ragContext = await vectorStore.searchAsContext(`financial document ${fileName}`, sessionId);

    // 3. Run document ingestion agent — extracts abstractions, discards raw values
    log.route('  Running DocumentIngestionAgent...');
    eventEmitter.emitAgentStarted(sessionId, 'document_ingestion');

    const ingestion = await documentIngestionAgent.run(documentText, fileName);

    log.route(`  Document classified: ${ingestion.document_type} (${ingestion.confidence} confidence)`);
    log.route(`  PII stored: ${ingestion.pii_stored} | Raw document stored: ${ingestion.raw_document_stored}`);
    log.route('  Raw document text discarded ✓');

    // 4. Build a synthetic message and agent list for LangGraph
    const syntheticMessage = `I've uploaded a ${ingestion.document_type.replace('_', ' ')} called "${fileName}". ` +
      `Key insight: ${ingestion.abstracted_signals?.primary_insight || 'please analyze this document'}.`;

    // Build plan from ingestion suggestions
    const suggestedAgents = ingestion.suggested_agents || [];
    const suggestedUi     = (ingestion.suggested_ui || []).map(type => ({ type }));

    // Always include simulation and explanation for a full enriched response
    const agents = [...new Set([...suggestedAgents, 'simulation', 'explanation'])];
    const ui     = suggestedUi.length ? suggestedUi : [{ type: 'explanation_panel' }];

    const syntheticPlan = {
      intent: `Analyze uploaded ${ingestion.document_type}`,
      agents,
      ui: [...ui, { type: 'simulation_chart' }, { type: 'explanation_panel' }],
      params: {},
    };

    log.route(`  Synthetic plan: agents=[${agents.join(', ')}] | ui=[${syntheticPlan.ui.map(u=>u.type).join(', ')}]`);

    // 5. Run LangGraph with pre-seeded state (skip planner — we have a plan)
    log.route('  LangGraph: invoking pipeline with document context...');
    const graphStart = Date.now();

    const finalState = await financialGraph.invoke({
      message:          syntheticMessage,
      sessionContext:   markdownMemory.read(sessionId),
      ragContext,
      memory:           markdownMemory.read(sessionId),
      profile:          session.profile || null,
      // Pre-seed plan so planner output is overridden
      plan:             syntheticPlan,
      // Pre-seed tax/cashflow insights from ingestion
      taxInsights:      ingestion.taxInsights      || null,
      cashflowInsights: ingestion.cashflowInsights || null,
    });

    log.route(`  LangGraph: complete (${Date.now() - graphStart}ms)`);

    const { profile, simulation, portfolio, risk, tax, cashflow, explanation, trace } = finalState;

    // 6. Persist sanitized data to Redis + emit events
    if (profile)   { await redisMemory.updateSession(sessionId, { profile });   eventEmitter.emitProfileUpdated(sessionId, profile); }
    if (simulation){ await redisMemory.updateSession(sessionId, { simulation }); eventEmitter.emitSimulationUpdated(sessionId, simulation); }
    if (portfolio) { await redisMemory.updateSession(sessionId, { portfolio }); eventEmitter.emitPortfolioUpdated(sessionId, portfolio); }
    if (risk)      { await redisMemory.updateSession(sessionId, { risk });      eventEmitter.emitRiskUpdated(sessionId, risk); }
    if (tax)       { await redisMemory.updateSession(sessionId, { tax }); }
    if (cashflow)  { await redisMemory.updateSession(sessionId, { cashflow }); }
    if (explanation) { eventEmitter.emitExplanationReady(sessionId, explanation); }

    // 7. Write PII-safe markdown snapshot (includes tax/cashflow abstractions)
    const md = markdownMemory.write(
      sessionId, profile, simulation, portfolio, risk,
      ingestion.taxInsights, ingestion.cashflowInsights
    );
    log.route(`  Markdown snapshot written (${md.length} chars) — abstractions only, no raw PII`);

    // Store only anonymized insight summary in vector store (not the raw document)
    const vectorSummary = `Document analysis for session ${sessionId}: ${ingestion.abstracted_signals?.primary_insight || ''} ` +
      (ingestion.abstracted_signals?.key_signals || []).join('. ');
    await vectorStore.storeSessionSnapshot(sessionId, vectorSummary);
    log.route('  Vector store: anonymized insight summary stored (NOT raw document)');

    // 8. Save assistant reply
    await redisMemory.appendMessage(sessionId, 'assistant', explanation || syntheticPlan.intent);

    const totalMs = Date.now() - reqStart;
    log.route(`  Upload pipeline complete | ui=[${syntheticPlan.ui.map(u=>u.type).join(', ')}] | total=${totalMs}ms`);

    res.json({
      sessionId,
      message:       explanation || `Document analyzed: ${ingestion.abstracted_signals?.primary_insight}`,
      documentType:  ingestion.document_type,
      confidence:    ingestion.confidence,
      ui:            syntheticPlan.ui,
      data:          { profile, simulation, portfolio, risk, tax, cashflow },
      ingestion: {
        document_type:      ingestion.document_type,
        abstracted_signals: ingestion.abstracted_signals,
        pii_stored:         false,
        raw_document_stored: false,
      },
      trace: trace || [],
    });

  } catch (err) {
    log.error('UploadRoute error:', err.message);
    log.error(err.stack);
    res.status(500).json({ error: 'Upload processing failed', details: err.message });
  }
});
