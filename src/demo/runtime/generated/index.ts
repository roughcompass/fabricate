import type { ComponentType, ReactNode } from "react";
import payee_list_2_0_0 from "./payments-workspace/payee-list/2.0.0";
import payee_list_1_4_2 from "./payments-workspace/payee-list/1.4.2";
import payee_list_2_1_0_beta_1 from "./payments-workspace/payee-list/2.1.0-beta.1";
import transfer_form_3_1_0 from "./payments-workspace/transfer-form/3.1.0";
import transfer_form_3_0_1 from "./payments-workspace/transfer-form/3.0.1";
import payment_activity_2_3_0 from "./payments-workspace/payment-activity/2.3.0";
import client_search_4_2_0 from "./client-onboarding/client-search/4.2.0";
import client_search_4_1_0 from "./client-onboarding/client-search/4.1.0";
import kyc_checklist_3_3_0 from "./client-onboarding/kyc-checklist/3.3.0";
import kyc_checklist_3_2_0 from "./client-onboarding/kyc-checklist/3.2.0";
import kyc_checklist_4_0_0_rc_1 from "./client-onboarding/kyc-checklist/4.0.0-rc.1";
import document_review_1_6_0 from "./client-onboarding/document-review/1.6.0";
import watchlist_1_9_0 from "./market-watch/watchlist/1.9.0";
import watchlist_1_8_0 from "./market-watch/watchlist/1.8.0";
import watchlist_2_0_0_beta_2 from "./market-watch/watchlist/2.0.0-beta.2";
import order_ticket_2_2_0 from "./market-watch/order-ticket/2.2.0";
import price_chart_5_1_0 from "./market-watch/price-chart/5.1.0";
import price_chart_5_0_0 from "./market-watch/price-chart/5.0.0";
import trade_blotter_3_5_0 from "./market-watch/trade-blotter/3.5.0";
import incident_feed_6_1_0 from "./operations-console/incident-feed/6.1.0";
import incident_feed_6_0_0 from "./operations-console/incident-feed/6.0.0";
import incident_feed_7_0_0_alpha_3 from "./operations-console/incident-feed/7.0.0-alpha.3";
import service_health_2_4_0 from "./operations-console/service-health/2.4.0";
import change_calendar_1_2_0 from "./operations-console/change-calendar/1.2.0";
import shell_access from "./shells/access";
import shell_markets from "./shells/markets";

/** Written by `npm run heroes:generate` (scripts/generate-heroes.ts): every generated microfrontend version, by member and version. */
export const GENERATED_MEMBERS: Readonly<Record<string, Readonly<Record<string, ComponentType>>>> = {
  "payee-list": { "2.0.0": payee_list_2_0_0, "1.4.2": payee_list_1_4_2, "2.1.0-beta.1": payee_list_2_1_0_beta_1 },
  "transfer-form": { "3.1.0": transfer_form_3_1_0, "3.0.1": transfer_form_3_0_1 },
  "payment-activity": { "2.3.0": payment_activity_2_3_0 },
  "client-search": { "4.2.0": client_search_4_2_0, "4.1.0": client_search_4_1_0 },
  "kyc-checklist": { "3.3.0": kyc_checklist_3_3_0, "3.2.0": kyc_checklist_3_2_0, "4.0.0-rc.1": kyc_checklist_4_0_0_rc_1 },
  "document-review": { "1.6.0": document_review_1_6_0 },
  "watchlist": { "1.9.0": watchlist_1_9_0, "1.8.0": watchlist_1_8_0, "2.0.0-beta.2": watchlist_2_0_0_beta_2 },
  "order-ticket": { "2.2.0": order_ticket_2_2_0 },
  "price-chart": { "5.1.0": price_chart_5_1_0, "5.0.0": price_chart_5_0_0 },
  "trade-blotter": { "3.5.0": trade_blotter_3_5_0 },
  "incident-feed": { "6.1.0": incident_feed_6_1_0, "6.0.0": incident_feed_6_0_0, "7.0.0-alpha.3": incident_feed_7_0_0_alpha_3 },
  "service-health": { "2.4.0": service_health_2_4_0 },
  "change-calendar": { "1.2.0": change_calendar_1_2_0 },
};

/** The generated portal shells, by kind; each takes the current route's content as children. */
export const GENERATED_SHELLS: Readonly<Partial<Record<"access" | "markets", ComponentType<{ children: ReactNode }>>>> = { access: shell_access, markets: shell_markets };
