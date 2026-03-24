/**
 * UI Composer — builds A2UI v2 schema deterministically.
 *
 * Responsibility: given planner output + current computed state,
 * produce a rich UI component array. No LLM is called here.
 *
 * Schema per component:
 * {
 *   id:      string            — stable per request (type + position)
 *   type:    string            — component identifier (simulation_chart, etc.)
 *   data:    object            — pre-fetched slice of state for this component
 *   meta: {
 *     priority:    high|medium|low
 *     layout:      full_width|half|sidebar
 *     position:    number
 *     trigger:     EVENT_NAME (WebSocket event that refreshes this component)
 *     stage:       summary|detailed|recommendation
 *     behavior: { expandOnLoad: bool, interactive: bool }
 *   }
 *   insight: {
 *     reason:     string   — WHY this component is shown (from planner rationale)
 *     summary:    string   — SHORT description of what the data shows
 *     confidence: 0.0-1.0  — planner confidence mapped to number
 *   }
 *   actions: [{ label: string, action: ACTION_TYPE }]
 * }
 *
 * WHAT to show → planner decides (agents[], ui[] list)
 * WHEN to show → trigger field (WebSocket event name)
 * HOW to show  → layout, behavior, expandOnLoad
 * WHY it shown → insight.reason (planner rationale) + insight.summary (state-derived)
 */

import { log } from '../logger.js';

// ── Component registry ────────────────────────────────────────────────────────
// Deterministic rules: every supported component type → display properties.

const REGISTRY = {
  profile_summary: {
    priority:     'high',
    layout:       'half',
    stage:        'summary',
    trigger:      'PROFILE_UPDATED',
    expandOnLoad: false,
    interactive:  false,
    actions: [
      { label: 'Edit profile', action: 'EDIT_PROFILE' },
    ],
  },

  simulation_chart: {
    priority:     'high',
    layout:       'full_width',
    stage:        'summary',
    trigger:      'SIMULATION_UPDATED',
    expandOnLoad: true,
    interactive:  true,
    actions: [
      { label: 'Adjust retirement age', action: 'EDIT_RETIREMENT_AGE' },
      { label: 'Change savings rate',   action: 'EDIT_SAVINGS_RATE'   },
    ],
  },

  portfolio_view: {
    priority:     'medium',
    layout:       'half',
    stage:        'detailed',
    trigger:      'PORTFOLIO_UPDATED',
    expandOnLoad: false,
    interactive:  true,
    actions: [
      { label: 'Adjust risk tolerance', action: 'EDIT_RISK_TOLERANCE' },
    ],
  },

  risk_dashboard: {
    priority:     'medium',
    layout:       'half',
    stage:        'detailed',
    trigger:      'RISK_UPDATED',
    expandOnLoad: false,
    interactive:  false,
    actions: [
      { label: 'View mitigation steps', action: 'EXPAND_RISK_DETAILS' },
    ],
  },

  tax_panel: {
    priority:     'high',
    layout:       'full_width',
    stage:        'recommendation',
    trigger:      'TAX_UPDATED',
    expandOnLoad: true,
    interactive:  false,
    actions: [
      { label: 'View all strategies', action: 'EXPAND_TAX_STRATEGIES' },
    ],
  },

  cashflow_panel: {
    priority:     'medium',
    layout:       'full_width',
    stage:        'recommendation',
    trigger:      'CASHFLOW_UPDATED',
    expandOnLoad: false,
    interactive:  false,
    actions: [
      { label: 'View recommendations', action: 'EXPAND_CASHFLOW_RECS' },
    ],
  },

  explanation_panel: {
    priority:     'high',
    layout:       'full_width',
    stage:        'summary',
    trigger:      'EXPLANATION_READY',
    expandOnLoad: true,
    interactive:  false,
    actions: [],
  },
};

// ── Confidence mapper ─────────────────────────────────────────────────────────

function toConfidence(planConfidence) {
  return planConfidence === 'high'   ? 0.9
       : planConfidence === 'medium' ? 0.7
       : 0.5;
}

// ── Insight builders — one per component, deterministic ───────────────────────
// Each produces: { reason, summary, confidence }
// reason  = WHY this panel was chosen (from planner)
// summary = WHAT the data shows (from state)

function buildInsight(type, plan, state) {
  const confidence = toConfidence(plan.confidence);
  const reason     = plan.decision_rationale || plan.intent || 'Financial planning request';

  switch (type) {
    case 'simulation_chart': {
      const sim = state.simulation;
      if (!sim) return { reason, summary: 'Calculating retirement projection…', confidence };
      const summary = sim.can_retire_at_target
        ? `On track — $${sim.projected_savings_at_retirement.toLocaleString()} projected vs $${sim.required_savings_at_retirement.toLocaleString()} required`
        : `$${sim.savings_gap.toLocaleString()} gap — $${Math.abs(sim.monthly_shortfall_or_surplus).toLocaleString()}/mo shortfall`;
      return { reason, summary, confidence };
    }

    case 'profile_summary': {
      const p = state.profile;
      if (!p) return { reason, summary: 'Profile extracted from conversation', confidence };
      return {
        reason,
        summary: `${p.name || 'User'}, age ${p.age} — target retirement at ${p.retirement_age} (${(p.retirement_age || 65) - (p.age || 35)} years away)`,
        confidence,
      };
    }

    case 'portfolio_view': {
      const port = state.portfolio;
      if (!port) return { reason, summary: 'Portfolio allocation computed', confidence };
      const equities = (port.allocation || []).find((a) => a.asset === 'Equities')?.percent ?? '?';
      return {
        reason,
        summary: `${port.strategy} strategy — ${equities}% equities, ${port.expected_annual_return_percent}% expected annual return`,
        confidence,
      };
    }

    case 'risk_dashboard': {
      const risk = state.risk;
      if (!risk) return { reason, summary: 'Risk assessment computed', confidence };
      const crash = Math.abs(risk.stress_test?.market_crash_20pct_impact || 0).toLocaleString();
      return {
        reason,
        summary: `Risk score ${risk.overall_risk_score}/10 (${risk.risk_level}) — $${crash} exposed in 20% market crash`,
        confidence,
      };
    }

    case 'tax_panel': {
      const tax = state.tax;
      if (!tax) return { reason: 'Tax document uploaded', summary: 'Analyzing tax signals…', confidence: 0.85 };
      const strategies = tax.optimization_strategies?.length || 0;
      return {
        reason: 'Tax document uploaded and analyzed',
        summary: `${tax.tax_bracket} bracket — efficiency ${tax.tax_efficiency_score}/10, ${strategies} optimization strateg${strategies === 1 ? 'y' : 'ies'} identified`,
        confidence: 0.85,
      };
    }

    case 'cashflow_panel': {
      const cf = state.cashflow;
      if (!cf) return { reason: 'Bank statement uploaded', summary: 'Analyzing spending patterns…', confidence: 0.8 };
      return {
        reason: 'Bank statement uploaded and analyzed',
        summary: `${cf.budget_health} budget health — ${cf.savings_rate_label} savings rate, spending level ${cf.spending_level}`,
        confidence: 0.8,
      };
    }

    case 'explanation_panel':
      return {
        reason: 'Synthesises all computed results into a direct answer',
        summary: plan.intent || 'Personalized financial analysis',
        confidence,
      };

    default:
      return { reason, summary: '', confidence: 0.5 };
  }
}

// ── Data extractor — state slice per component ────────────────────────────────

function extractData(type, state) {
  switch (type) {
    case 'profile_summary':   return state.profile    ?? {};
    case 'simulation_chart':  return state.simulation ?? {};
    case 'portfolio_view':    return state.portfolio  ?? {};
    case 'risk_dashboard':    return state.risk       ?? {};
    case 'tax_panel':         return state.tax        ?? {};
    case 'cashflow_panel':    return state.cashflow   ?? {};
    case 'explanation_panel': return {};   // text comes via HTTP response message field
    default:                  return {};
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build the full A2UI v2 component array.
 *
 * @param {object} plan   Planner output: { intent, ui[], confidence, decision_rationale }
 * @param {object} state  Current computed state: { profile, simulation, portfolio, ... }
 * @returns {object[]}    A2UI v2 component array (ready to send to frontend)
 */
export function composeUI(plan, state = {}) {
  if (!plan?.ui?.length) {
    log.warn('[UIComposer] plan.ui is empty — returning empty component array');
    return [];
  }

  const components = plan.ui.map((component, index) => {
    const type = typeof component === 'string' ? component : (component.type || '');
    const reg  = REGISTRY[type] || {
      priority: 'low', layout: 'full_width', stage: 'summary',
      trigger: null, expandOnLoad: false, interactive: false, actions: [],
    };

    return {
      id:   `${type}-${index}`,
      type,
      data: extractData(type, state),
      meta: {
        priority:    reg.priority,
        layout:      reg.layout,
        position:    index,
        trigger:     reg.trigger,
        stage:       reg.stage,
        behavior: {
          expandOnLoad: reg.expandOnLoad,
          interactive:  reg.interactive,
        },
      },
      insight: buildInsight(type, plan, state),
      actions: reg.actions,
      version: state._version ?? 0,
    };
  });

  const types = components.map((c) => `${c.type}[${c.meta.priority}/${c.meta.layout}]`).join(', ');
  log.info(`[UIComposer] composed ${components.length} components: ${types}`);

  return components;
}

/**
 * Build placeholder A2UI components in loading state.
 * Called immediately after the planner decides, before agents run.
 * The frontend can render skeletons while the real data is being computed.
 *
 * @param {object}   plan          Planner output (must have a ui[] array)
 * @param {string[]} [loadingAgents=[]]  Names of agents that are still running
 * @returns {object[]}  A2UI v2 components with loading:true and empty data
 */
export function composeLoadingState(plan, loadingAgents = []) {
  if (!plan?.ui?.length) {
    log.warn('[UIComposer] composeLoadingState: plan.ui is empty — returning []');
    return [];
  }

  const components = plan.ui.map((component, index) => {
    const type = typeof component === 'string' ? component : (component.type || '');
    const reg  = REGISTRY[type] || {
      priority:     'low',
      layout:       'full_width',
      stage:        'summary',
      trigger:      null,
      expandOnLoad: false,
      interactive:  false,
      actions:      [],
    };

    return {
      id:      `${type}-${index}`,
      type,
      data:    {},
      loading: true,
      meta: {
        priority:    reg.priority,
        layout:      reg.layout,
        position:    index,
        trigger:     reg.trigger,
        stage:       reg.stage,
        behavior: {
          expandOnLoad: reg.expandOnLoad,
          interactive:  reg.interactive,
        },
      },
      insight: {
        reason:     (typeof component === 'object' && component.panel_reason) || 'Loading…',
        summary:    'Computing…',
        confidence: 0,
      },
      actions: reg.actions,
      version: 0,
    };
  });

  log.info(
    `[UIComposer] composeLoadingState — ${components.length} skeleton components` +
    (loadingAgents.length ? ` | loading agents: [${loadingAgents.join(', ')}]` : ''),
  );

  return components;
}
