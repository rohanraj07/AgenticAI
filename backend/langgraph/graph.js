import { StateGraph, END } from '@langchain/langgraph';
import { PlannerAgent }    from '../agents/planner.agent.js';
import { ProfileAgent }    from '../agents/profile.agent.js';
import { SimulationAgent } from '../agents/simulation.agent.js';
import { PortfolioAgent }  from '../agents/portfolio.agent.js';
import { RiskAgent }       from '../agents/risk.agent.js';
import { ExplanationAgent } from '../agents/explanation.agent.js';
import { TaxAgent }        from '../agents/tax.agent.js';
import { CashflowAgent }   from '../agents/cashflow.agent.js';
import { log } from '../logger.js';

const plannerAgent     = new PlannerAgent();
const profileAgent     = new ProfileAgent();
const simulationAgent  = new SimulationAgent();
const portfolioAgent   = new PortfolioAgent();
const riskAgent        = new RiskAgent();
const explanationAgent = new ExplanationAgent();
const taxAgent         = new TaxAgent();
const cashflowAgent    = new CashflowAgent();

const graphChannels = {
  message:          { value: (a, b) => b ?? a, default: () => '' },
  sessionContext:   { value: (a, b) => b ?? a, default: () => '' },
  ragContext:       { value: (a, b) => b ?? a, default: () => '' },
  memory:           { value: (a, b) => b ?? a, default: () => '' },
  plan:             { value: (a, b) => b ?? a, default: () => null },
  profile:          { value: (a, b) => b ?? a, default: () => null },
  simulation:       { value: (a, b) => b ?? a, default: () => null },
  portfolio:        { value: (a, b) => b ?? a, default: () => null },
  risk:             { value: (a, b) => b ?? a, default: () => null },
  tax:              { value: (a, b) => b ?? a, default: () => null },
  cashflow:         { value: (a, b) => b ?? a, default: () => null },
  taxInsights:      { value: (a, b) => b ?? a, default: () => null },
  cashflowInsights: { value: (a, b) => b ?? a, default: () => null },
  explanation:      { value: (a, b) => b ?? a, default: () => '' },
  trace:            { value: (a, b) => [...(a || []), ...(b || [])], default: () => [] },
};

const DEFAULT_PROFILE = {
  name: 'User', age: 35, income: 80000, savings: 200000,
  monthly_expenses: 3500, retirement_age: 65, risk_tolerance: 'medium', goals: [],
};
const DEFAULT_SIMULATION = {
  can_retire_at_target: false, projected_savings_at_retirement: 0,
  monthly_shortfall_or_surplus: 0, years_of_runway: 0, milestones: [], summary: '',
};
const DEFAULT_PORTFOLIO = {
  allocation: [
    { asset: 'Equities', percent: 60 }, { asset: 'Bonds', percent: 30 },
    { asset: 'Real Estate', percent: 5 }, { asset: 'Cash', percent: 5 },
  ],
  strategy: 'balanced', expected_annual_return_percent: 7,
  rebalance_frequency: 'annually', rationale: '',
};

// ── Node functions ────────────────────────────────────────────────────────────

async function runPlanner(state) {
  const start = Date.now();
  log.graph('▶ node_planner START | message:', state.message.slice(0, 80));
  const plan = await plannerAgent.run(state.message, state.sessionContext);
  const ms = Date.now() - start;
  log.graph(`✔ node_planner DONE (${ms}ms) | intent: "${plan.intent}" | agents: [${plan.agents?.join(', ')}] | ui: [${plan.ui?.map(u=>u.type).join(', ')}]`);
  return { plan, trace: [{ agent: 'planner', latencyMs: ms, output: plan }] };
}

async function runProfile(state) {
  const start = Date.now();
  log.graph('▶ node_profile START');
  const profile = await profileAgent.run(state.message, state.memory, state.ragContext);
  const ms = Date.now() - start;
  log.graph(`✔ node_profile DONE (${ms}ms) | name: ${profile.name}, age: ${profile.age}, income: $${profile.income}, savings: $${profile.savings}, risk: ${profile.risk_tolerance}`);
  return { profile, trace: [{ agent: 'profile', latencyMs: ms, output: profile }] };
}

async function runSimulation(state) {
  const start = Date.now();
  const profile = state.profile ?? DEFAULT_PROFILE;
  log.graph(`▶ node_simulation START | profile: age=${profile.age}, savings=$${profile.savings}, retire_at=${profile.retirement_age}`);
  const simulation = await simulationAgent.run(profile, state.message, state.ragContext);
  const ms = Date.now() - start;
  log.graph(`✔ node_simulation DONE (${ms}ms) | can_retire=${simulation.can_retire_at_target} | projected=$${simulation.projected_savings_at_retirement} | surplus/shortfall=$${simulation.monthly_shortfall_or_surplus}/mo | runway=${simulation.years_of_runway}yrs`);
  log.graph(`  Summary: "${simulation.summary?.slice(0,120)}"`);
  return { simulation, trace: [{ agent: 'simulation', latencyMs: ms, output: simulation }] };
}

async function runPortfolio(state) {
  const start = Date.now();
  const profile = state.profile ?? DEFAULT_PROFILE;
  const simulation = state.simulation ?? DEFAULT_SIMULATION;
  log.graph(`▶ node_portfolio START | risk_tolerance: ${profile.risk_tolerance}`);
  const portfolio = await portfolioAgent.run(profile, simulation);
  const ms = Date.now() - start;
  const alloc = (portfolio.allocation || []).map(a => `${a.asset}:${a.percent}%`).join(', ');
  log.graph(`✔ node_portfolio DONE (${ms}ms) | strategy: ${portfolio.strategy} | return: ${portfolio.expected_annual_return_percent}%/yr | allocation: [${alloc}]`);
  log.graph(`  Rationale: "${portfolio.rationale?.slice(0,120)}"`);
  return { portfolio, trace: [{ agent: 'portfolio', latencyMs: ms, output: portfolio }] };
}

async function runRisk(state) {
  const start = Date.now();
  const profile = state.profile ?? DEFAULT_PROFILE;
  const portfolio = state.portfolio ?? DEFAULT_PORTFOLIO;
  log.graph(`▶ node_risk START | portfolio strategy: ${portfolio.strategy}`);
  const risk = await riskAgent.run(profile, portfolio);
  const ms = Date.now() - start;
  log.graph(`✔ node_risk DONE (${ms}ms) | score: ${risk.overall_risk_score}/10 | level: ${risk.risk_level}`);
  (risk.factors || []).forEach(f => log.graph(`  Factor: ${f.factor} [${f.impact}] — ${f.description?.slice(0,80)}`));
  (risk.mitigation_steps || []).forEach(s => log.graph(`  Mitigation: ${s}`));
  return { risk, trace: [{ agent: 'risk', latencyMs: ms, output: risk }] };
}

async function runTax(state) {
  const start = Date.now();
  const taxInsights = state.taxInsights;
  if (!taxInsights) {
    log.graph('▶ node_tax SKIP — no taxInsights in state');
    return {};
  }
  const profile = state.profile ?? DEFAULT_PROFILE;
  const simulation = state.simulation ?? null;
  log.graph(`▶ node_tax START | bracket: ${taxInsights.tax_bracket}, income: ${taxInsights.income_range}`);
  const tax = await taxAgent.run(taxInsights, profile, simulation);
  const ms = Date.now() - start;
  log.graph(`✔ node_tax DONE (${ms}ms) | efficiency: ${tax.tax_efficiency_score}/10 | strategies: ${tax.optimization_strategies?.length}`);
  return { tax, trace: [{ agent: 'tax', latencyMs: ms, output: tax }] };
}

async function runCashflow(state) {
  const start = Date.now();
  const cashflowInsights = state.cashflowInsights;
  if (!cashflowInsights) {
    log.graph('▶ node_cashflow SKIP — no cashflowInsights in state');
    return {};
  }
  const profile = state.profile ?? DEFAULT_PROFILE;
  log.graph(`▶ node_cashflow START | spending: ${cashflowInsights.spending_level}, savings: ${cashflowInsights.savings_rate}`);
  const cashflow = await cashflowAgent.run(cashflowInsights, profile);
  const ms = Date.now() - start;
  log.graph(`✔ node_cashflow DONE (${ms}ms) | budget: ${cashflow.budget_health} | recommendations: ${cashflow.recommendations?.length}`);
  return { cashflow, trace: [{ agent: 'cashflow', latencyMs: ms, output: cashflow }] };
}

async function runExplanation(state) {
  const start = Date.now();
  log.graph('▶ node_explanation START');
  const explanation = await explanationAgent.run(
    state.profile    ?? DEFAULT_PROFILE,
    state.simulation ?? DEFAULT_SIMULATION,
    state.portfolio  ?? DEFAULT_PORTFOLIO,
    state.risk       ?? null,
    state.message,
  );
  const ms = Date.now() - start;
  log.graph(`✔ node_explanation DONE (${ms}ms) | response (${explanation.length} chars): "${explanation.slice(0,150)}..."`);
  return { explanation, trace: [{ agent: 'explanation', latencyMs: ms, output: explanation }] };
}

// ── Routing functions ─────────────────────────────────────────────────────────

function routeAfterPlanner(state) {
  const agents = state.plan?.agents || [];
  const next = agents.includes('profile')   ? 'node_profile'   :
               agents.includes('tax')       ? 'node_tax'       :
               agents.includes('cashflow')  ? 'node_cashflow'  :
               agents.includes('simulation')? 'node_simulation':
               agents.includes('portfolio') ? 'node_portfolio' :
               agents.includes('risk')      ? 'node_risk'      : 'node_explanation';
  log.graph(`  route after planner → ${next}`);
  return next;
}

function routeAfterProfile(state) {
  const agents = state.plan?.agents || [];
  const next = agents.includes('tax')       ? 'node_tax'       :
               agents.includes('cashflow')  ? 'node_cashflow'  :
               agents.includes('simulation')? 'node_simulation':
               agents.includes('portfolio') ? 'node_portfolio' :
               agents.includes('risk')      ? 'node_risk'      : 'node_explanation';
  log.graph(`  route after profile → ${next}`);
  return next;
}

function routeAfterTax(state) {
  const agents = state.plan?.agents || [];
  const next = agents.includes('cashflow')  ? 'node_cashflow'  :
               agents.includes('simulation')? 'node_simulation':
               agents.includes('portfolio') ? 'node_portfolio' :
               agents.includes('risk')      ? 'node_risk'      : 'node_explanation';
  log.graph(`  route after tax → ${next}`);
  return next;
}

function routeAfterCashflow(state) {
  const agents = state.plan?.agents || [];
  const next = agents.includes('simulation')? 'node_simulation':
               agents.includes('portfolio') ? 'node_portfolio' :
               agents.includes('risk')      ? 'node_risk'      : 'node_explanation';
  log.graph(`  route after cashflow → ${next}`);
  return next;
}

function routeAfterSimulation(state) {
  const agents = state.plan?.agents || [];
  const next = agents.includes('portfolio')? 'node_portfolio':
               agents.includes('risk')     ? 'node_risk'     : 'node_explanation';
  log.graph(`  route after simulation → ${next}`);
  return next;
}

function routeAfterPortfolio(state) {
  const agents = state.plan?.agents || [];
  const next = agents.includes('risk') ? 'node_risk' : 'node_explanation';
  log.graph(`  route after portfolio → ${next}`);
  return next;
}

// ── Graph assembly ────────────────────────────────────────────────────────────

export function buildFinancialGraph() {
  const graph = new StateGraph({ channels: graphChannels });

  graph.addNode('node_planner',     runPlanner);
  graph.addNode('node_profile',     runProfile);
  graph.addNode('node_tax',         runTax);
  graph.addNode('node_cashflow',    runCashflow);
  graph.addNode('node_simulation',  runSimulation);
  graph.addNode('node_portfolio',   runPortfolio);
  graph.addNode('node_risk',        runRisk);
  graph.addNode('node_explanation', runExplanation);

  graph.addEdge('__start__', 'node_planner');

  graph.addConditionalEdges('node_planner', routeAfterPlanner, {
    node_profile:     'node_profile',
    node_tax:         'node_tax',
    node_cashflow:    'node_cashflow',
    node_simulation:  'node_simulation',
    node_portfolio:   'node_portfolio',
    node_risk:        'node_risk',
    node_explanation: 'node_explanation',
  });
  graph.addConditionalEdges('node_profile', routeAfterProfile, {
    node_tax:         'node_tax',
    node_cashflow:    'node_cashflow',
    node_simulation:  'node_simulation',
    node_portfolio:   'node_portfolio',
    node_risk:        'node_risk',
    node_explanation: 'node_explanation',
  });
  graph.addConditionalEdges('node_tax', routeAfterTax, {
    node_cashflow:    'node_cashflow',
    node_simulation:  'node_simulation',
    node_portfolio:   'node_portfolio',
    node_risk:        'node_risk',
    node_explanation: 'node_explanation',
  });
  graph.addConditionalEdges('node_cashflow', routeAfterCashflow, {
    node_simulation:  'node_simulation',
    node_portfolio:   'node_portfolio',
    node_risk:        'node_risk',
    node_explanation: 'node_explanation',
  });
  graph.addConditionalEdges('node_simulation', routeAfterSimulation, {
    node_portfolio:   'node_portfolio',
    node_risk:        'node_risk',
    node_explanation: 'node_explanation',
  });
  graph.addConditionalEdges('node_portfolio', routeAfterPortfolio, {
    node_risk:        'node_risk',
    node_explanation: 'node_explanation',
  });
  graph.addEdge('node_risk',        'node_explanation');
  graph.addEdge('node_explanation', END);

  log.graph('Financial graph compiled — nodes: planner→profile→[tax→cashflow→]simulation→portfolio→risk→explanation');
  return graph.compile();
}
