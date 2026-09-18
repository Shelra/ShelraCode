import { t } from "./i18n";

export function renderTitle(): string {
  return t("checkout.title");
}

export function renderTotal(amount: string): string {
  return `TOTAL ${amount}`;
}
