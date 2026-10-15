// Shipment cost arithmetic with no database access, so the shipment form can preview it in the browser.

const round2 = (n: number) => Math.round(n * 100) / 100;

export type ShipmentStatus = "ordered" | "in_transit" | "arrived";
export const SHIPMENT_STATUSES: { value: ShipmentStatus; label: string }[] = [
  { value: "ordered", label: "Ordered" },
  { value: "in_transit", label: "In transit" },
  { value: "arrived", label: "Arrived at Amazon" },
];

/** Landed cost of one unit on a shipment line (pure, shared with the form's live preview). */
export function landedUnitCost(line: { qty: number; totalPaid: number }, shared: number, shipmentUnits: number) {
  if (!line.qty || !shipmentUnits) return 0;
  return round2(round2(line.totalPaid / line.qty) + round2(shared / shipmentUnits));
}

/** What a line cost when "total paid" is left blank: qty × unit price + misc charges. */
export const defaultTotalPaid = (qty: number, unitPrice: number, misc: number) => round2(qty * unitPrice + misc);

