/**
 * Document Routing — maps document types to agent pipelines and UI components.
 *
 * Usage:
 *   import { routeDocument } from '../utils/document.routing.js';
 *   const { agents, ui, insightKey } = routeDocument(docType);
 */

export const ROUTING_MAP = {
  tax_document: {
    // profile runs first so simulation has real profile data
    agents:    ['profile', 'tax', 'simulation', 'explanation'],
    ui:        ['profile_summary', 'tax_panel', 'simulation_chart', 'explanation_panel'],
    insightKey: 'taxInsights',
  },
  bank_statement: {
    agents:    ['profile', 'cashflow', 'simulation', 'explanation'],
    ui:        ['profile_summary', 'cashflow_panel', 'simulation_chart', 'explanation_panel'],
    insightKey: 'cashflowInsights',
  },
  investment_statement: {
    agents:    ['profile', 'portfolio', 'risk', 'simulation', 'explanation'],
    ui:        ['profile_summary', 'portfolio_view', 'risk_dashboard', 'simulation_chart', 'explanation_panel'],
    insightKey: 'portfolioInsights',
  },
  debt_document: {
    agents:    ['profile', 'simulation', 'cashflow', 'explanation'],
    ui:        ['profile_summary', 'simulation_chart', 'cashflow_panel', 'explanation_panel'],
    insightKey: 'debtInsights',
  },
  unknown: {
    agents:    ['profile', 'simulation', 'explanation'],
    ui:        ['profile_summary', 'simulation_chart', 'explanation_panel'],
    insightKey: null,
  },
};

/**
 * @param {string} documentType  Classified document type from DocumentIngestionAgent
 * @returns {{ agents: string[], ui: string[], insightKey: string|null }}
 */
export function routeDocument(documentType) {
  return ROUTING_MAP[documentType] || ROUTING_MAP.unknown;
}
