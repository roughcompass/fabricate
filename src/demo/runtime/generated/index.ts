import type { ComponentType, ReactNode } from "react";
import payee_list_1_4_2 from "./payments-workspace/payee-list/1.4.2";
import payee_list_2_0_0 from "./payments-workspace/payee-list/2.0.0";
import payee_list_2_1_0_beta_1 from "./payments-workspace/payee-list/2.1.0-beta.1";
import transfer_form_3_0_1 from "./payments-workspace/transfer-form/3.0.1";
import transfer_form_3_1_0 from "./payments-workspace/transfer-form/3.1.0";
import payment_activity_2_3_0 from "./payments-workspace/payment-activity/2.3.0";
import client_search_4_1_0 from "./client-onboarding/client-search/4.1.0";
import client_search_4_2_0 from "./client-onboarding/client-search/4.2.0";
import kyc_checklist_3_2_0 from "./client-onboarding/kyc-checklist/3.2.0";
import kyc_checklist_3_3_0 from "./client-onboarding/kyc-checklist/3.3.0";
import kyc_checklist_4_0_0_rc_1 from "./client-onboarding/kyc-checklist/4.0.0-rc.1";
import document_review_1_6_0 from "./client-onboarding/document-review/1.6.0";
import watchlist_1_8_0 from "./market-watch/watchlist/1.8.0";
import watchlist_1_9_0 from "./market-watch/watchlist/1.9.0";
import watchlist_2_0_0_beta_2 from "./market-watch/watchlist/2.0.0-beta.2";
import order_ticket_2_2_0 from "./market-watch/order-ticket/2.2.0";
import price_chart_5_0_0 from "./market-watch/price-chart/5.0.0";
import price_chart_5_1_0 from "./market-watch/price-chart/5.1.0";
import trade_blotter_3_5_0 from "./market-watch/trade-blotter/3.5.0";
import incident_feed_6_0_0 from "./operations-console/incident-feed/6.0.0";
import incident_feed_6_1_0 from "./operations-console/incident-feed/6.1.0";
import incident_feed_7_0_0_alpha_3 from "./operations-console/incident-feed/7.0.0-alpha.3";
import service_health_2_4_0 from "./operations-console/service-health/2.4.0";
import change_calendar_1_2_0 from "./operations-console/change-calendar/1.2.0";
import card_list_1_0_0 from "./corporate-card-controls/card-list/1.0.0";
import card_list_1_1_0 from "./corporate-card-controls/card-list/1.1.0";
import card_rules_1_0_0 from "./corporate-card-controls/card-rules/1.0.0";
import payment_tracker_1_0_0 from "./payment-status-tracker/payment-tracker/1.0.0";
import payment_tracker_1_1_0 from "./payment-status-tracker/payment-tracker/1.1.0";
import stall_alerts_1_0_0 from "./payment-status-tracker/stall-alerts/1.0.0";
import payment_file_upload_1_0_0 from "./bulk-payments-upload/payment-file-upload/1.0.0";
import payment_file_upload_1_1_0 from "./bulk-payments-upload/payment-file-upload/1.1.0";
import batch_release_1_0_0 from "./bulk-payments-upload/batch-release/1.0.0";
import facility_list_1_0_0 from "./credit-facility-tracker/facility-list/1.0.0";
import facility_list_1_1_0 from "./credit-facility-tracker/facility-list/1.1.0";
import covenant_checks_1_0_0 from "./credit-facility-tracker/covenant-checks/1.0.0";
import relationship_list_1_0_0 from "./relationship-notes/relationship-list/1.0.0";
import relationship_list_1_1_0 from "./relationship-notes/relationship-list/1.1.0";
import meeting_notes_1_0_0 from "./relationship-notes/meeting-notes/1.0.0";
import deal_documents_1_0_0 from "./deal-room/deal-documents/1.0.0";
import deal_documents_1_1_0 from "./deal-room/deal-documents/1.1.0";
import open_items_1_0_0 from "./deal-room/open-items/1.0.0";
import research_library_1_0_0 from "./research-hub/research-library/1.0.0";
import research_library_1_1_0 from "./research-hub/research-library/1.1.0";
import research_reader_1_0_0 from "./research-hub/research-reader/1.0.0";
import fx_rates_1_0_0 from "./fx-rates-board/fx-rates/1.0.0";
import fx_rates_1_1_0 from "./fx-rates-board/fx-rates/1.1.0";
import rate_detail_1_0_0 from "./fx-rates-board/rate-detail/1.0.0";
import desk_limits_1_0_0 from "./risk-limits-monitor/desk-limits/1.0.0";
import desk_limits_1_1_0 from "./risk-limits-monitor/desk-limits/1.1.0";
import limit_breaches_1_0_0 from "./risk-limits-monitor/limit-breaches/1.0.0";
import people_search_1_0_0 from "./team-directory/people-search/1.0.0";
import people_search_1_1_0 from "./team-directory/people-search/1.1.0";
import joiner_checklist_1_0_0 from "./team-directory/joiner-checklist/1.0.0";
import release_windows_1_0_0 from "./release-calendar/release-windows/1.0.0";
import release_windows_1_1_0 from "./release-calendar/release-windows/1.1.0";
import freeze_periods_1_0_0 from "./release-calendar/freeze-periods/1.0.0";
import flag_list_1_0_0 from "./feature-flag-console/flag-list/1.0.0";
import flag_list_1_1_0 from "./feature-flag-console/flag-list/1.1.0";
import flag_environments_1_0_0 from "./feature-flag-console/flag-environments/1.0.0";
import shell_access from "./shells/access";
import shell_markets from "./shells/markets";

/** Written by `npm run templates:build` (scripts/build-templates.ts): every template's microfrontend versions, by member and version. */
export const GENERATED_MEMBERS: Readonly<Record<string, Readonly<Record<string, ComponentType>>>> = {
  "payee-list": { "1.4.2": payee_list_1_4_2, "2.0.0": payee_list_2_0_0, "2.1.0-beta.1": payee_list_2_1_0_beta_1 },
  "transfer-form": { "3.0.1": transfer_form_3_0_1, "3.1.0": transfer_form_3_1_0 },
  "payment-activity": { "2.3.0": payment_activity_2_3_0 },
  "client-search": { "4.1.0": client_search_4_1_0, "4.2.0": client_search_4_2_0 },
  "kyc-checklist": { "3.2.0": kyc_checklist_3_2_0, "3.3.0": kyc_checklist_3_3_0, "4.0.0-rc.1": kyc_checklist_4_0_0_rc_1 },
  "document-review": { "1.6.0": document_review_1_6_0 },
  "watchlist": { "1.8.0": watchlist_1_8_0, "1.9.0": watchlist_1_9_0, "2.0.0-beta.2": watchlist_2_0_0_beta_2 },
  "order-ticket": { "2.2.0": order_ticket_2_2_0 },
  "price-chart": { "5.0.0": price_chart_5_0_0, "5.1.0": price_chart_5_1_0 },
  "trade-blotter": { "3.5.0": trade_blotter_3_5_0 },
  "incident-feed": { "6.0.0": incident_feed_6_0_0, "6.1.0": incident_feed_6_1_0, "7.0.0-alpha.3": incident_feed_7_0_0_alpha_3 },
  "service-health": { "2.4.0": service_health_2_4_0 },
  "change-calendar": { "1.2.0": change_calendar_1_2_0 },
  "card-list": { "1.0.0": card_list_1_0_0, "1.1.0": card_list_1_1_0 },
  "card-rules": { "1.0.0": card_rules_1_0_0 },
  "payment-tracker": { "1.0.0": payment_tracker_1_0_0, "1.1.0": payment_tracker_1_1_0 },
  "stall-alerts": { "1.0.0": stall_alerts_1_0_0 },
  "payment-file-upload": { "1.0.0": payment_file_upload_1_0_0, "1.1.0": payment_file_upload_1_1_0 },
  "batch-release": { "1.0.0": batch_release_1_0_0 },
  "facility-list": { "1.0.0": facility_list_1_0_0, "1.1.0": facility_list_1_1_0 },
  "covenant-checks": { "1.0.0": covenant_checks_1_0_0 },
  "relationship-list": { "1.0.0": relationship_list_1_0_0, "1.1.0": relationship_list_1_1_0 },
  "meeting-notes": { "1.0.0": meeting_notes_1_0_0 },
  "deal-documents": { "1.0.0": deal_documents_1_0_0, "1.1.0": deal_documents_1_1_0 },
  "open-items": { "1.0.0": open_items_1_0_0 },
  "research-library": { "1.0.0": research_library_1_0_0, "1.1.0": research_library_1_1_0 },
  "research-reader": { "1.0.0": research_reader_1_0_0 },
  "fx-rates": { "1.0.0": fx_rates_1_0_0, "1.1.0": fx_rates_1_1_0 },
  "rate-detail": { "1.0.0": rate_detail_1_0_0 },
  "desk-limits": { "1.0.0": desk_limits_1_0_0, "1.1.0": desk_limits_1_1_0 },
  "limit-breaches": { "1.0.0": limit_breaches_1_0_0 },
  "people-search": { "1.0.0": people_search_1_0_0, "1.1.0": people_search_1_1_0 },
  "joiner-checklist": { "1.0.0": joiner_checklist_1_0_0 },
  "release-windows": { "1.0.0": release_windows_1_0_0, "1.1.0": release_windows_1_1_0 },
  "freeze-periods": { "1.0.0": freeze_periods_1_0_0 },
  "flag-list": { "1.0.0": flag_list_1_0_0, "1.1.0": flag_list_1_1_0 },
  "flag-environments": { "1.0.0": flag_environments_1_0_0 },
};

/** The portal shells, by kind; each takes the current route's content as children. */
export const GENERATED_SHELLS: Readonly<Record<"access" | "markets", ComponentType<{ children: ReactNode }>>> = { access: shell_access, markets: shell_markets };
