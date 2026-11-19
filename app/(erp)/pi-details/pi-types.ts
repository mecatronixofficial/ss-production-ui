export type PiStage = {
  batchCode: string; color: string | null; stage: string; state: string;
  startedAt: string | null; finishedAt: string | null; mill: string | null;
  inputKg: number; returnedKg: number; outputKg: number | null;
  lossKg: number | null; gainKg: number | null; expense: number; balanceKg: number | null;
};

export type PiDetails = {
  id: string; code: string; piNo: string | null; yarnCode: string | null; yarnCount: string;
  fabric: string; startedAt: string | null;
  purchase: { receiptNo: string; receivedAt: string | null; mill: string; dcNo: string; weightKg: number; ratePerKg: number | null; amount: number | null } | null;
  yarn: { givenKg: number; usedKg: number | null; ratePerKg: number; amount: number; returnedKg: number; atMillKg: number; lossKg: number | null; stockKg: number; sharedStock: boolean };
  summary: { productionLossKg: number; productionGainKg: number; finishedKg: number; deliveredKg: number; pendingReceiptKg: number; receiptDifferenceKg: number; remainingKg: number; totalExpense: number; totalCost: number };
  balances: Array<{ material: string; kg: number }>;
  stages: PiStage[];
  costs: { yarnAmount: number; purchaseOther: number; knitting: number; dyeing: number; compacting: number; delivery: number; additional: number };
  expenses: Array<{ id: string; batchCode: string; date: string | null; category: string; description: string | null; amount: number }>;
  deliveries: Array<{ id: string; batchCode: string; stage: string; date: string | null; destination: string; to: string; sentKg: number; receivedKg: number | null; receivedAt: string | null; amount: number; expense: number; material: string }>;
  warehouseStock: Array<{ code: string; material: string; warehouse: string; lotNo: string | null; kg: number; sourceYarn: boolean }>;
  sales: Array<{ id: string; code: string; billNo: string; date: string | null; party: string; warehouse: string; material: string; kg: number; rate: number; amount: number }>;
};

export type PiResponse = { data: { rows: PiDetails[]; page: number; pageSize: number; total: number } };
export type PiOne = { data: PiDetails };
