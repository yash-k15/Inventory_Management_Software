export type WastageMode = 'percent' | 'per_g';
export type PricingMethod = 'direct' | 'global' | 'custom_all' | 'custom_individual';

export interface PricingRates {
  goldRatePaisePerGram: number;
  wastageMode: WastageMode;
  wastagePercentBp: number;
  wastagePaisePerGram: number;
  certificationPaisePerCarat: number;
  gstRateBp: number;
  diamondRatesPaisePerCarat: Record<string, number>;
  stoneRatesPaisePerUnit: Record<string, number>;
}

export interface PricingDiamond {
  shapeId: number;
  shape: string;
  combinationId: number | null;
  quality: string | null;
  weightMilliCarats: number;
}

export interface PricingStone {
  stoneTypeId: number;
  stone: string;
  weightUnit: 'ct' | 'g';
  weightMilli: number;
}

export interface PricingItem {
  inventoryItemId: number;
  itemNumber: string;
  grossWeightMilli: number | null;
  netWeightMilli: number | null;
  purityPercentBp: number;
  diamonds: PricingDiamond[];
  stones: PricingStone[];
  certified: boolean;
}

export interface PricingBreakdown {
  source: PricingMethod;
  item_number: string;
  net_gold_g: number;
  purity_percent_bp: number;
  gold_rate_paise_per_g: number;
  gold_value_paise: number;
  wastage_mode: WastageMode;
  wastage_value_paise: number;
  diamond_value_paise: number;
  stone_value_paise: number;
  certification_value_paise: number;
  subtotal_paise: number;
  gst_rate_bp: number;
  gst_value_paise: number;
  calculated_total_paise: number;
  agreed_price_paise: number;
  rates_snapshot: PricingRates;
  diamond_lines: Array<{ shape: string; quality: string | null; weight_ct: number; rate_paise_per_ct: number; value_paise: number }>;
  stone_lines: Array<{ stone: string; weight: number; unit: 'ct' | 'g'; rate_paise_per_unit: number; value_paise: number }>;
}

const roundMoney = (value: number) => Math.max(0, Math.round(value));

export function calculateItemPrice(
  item: PricingItem,
  rates: PricingRates,
  method: PricingMethod,
  agreedPricePaise?: number,
): PricingBreakdown {
  const netGoldMilli = item.netWeightMilli ?? item.grossWeightMilli ?? 0;
  const netGoldGrams = Math.max(0, netGoldMilli / 1000);
  const actualGoldGrams = netGoldGrams * (item.purityPercentBp / 10000);
  const goldValue = roundMoney(actualGoldGrams * rates.goldRatePaisePerGram);
  const wastageValue = rates.wastageMode === 'percent'
    ? roundMoney(netGoldGrams * rates.goldRatePaisePerGram * rates.wastagePercentBp / 10000)
    : roundMoney(netGoldGrams * rates.wastagePaisePerGram);

  const diamondLines = item.diamonds.map((diamond) => {
    const key = String(diamond.combinationId ?? diamond.shapeId);
    const rate = rates.diamondRatesPaisePerCarat[key] ?? 0;
    const weight = diamond.weightMilliCarats / 1000;
    return { shape: diamond.shape, quality: diamond.quality, weight_ct: weight, rate_paise_per_ct: rate, value_paise: roundMoney(weight * rate) };
  });
  const stoneLines = item.stones.map((stone) => {
    const rate = rates.stoneRatesPaisePerUnit[String(stone.stoneTypeId)] ?? 0;
    const weight = stone.weightMilli / 1000;
    return { stone: stone.stone, weight, unit: stone.weightUnit, rate_paise_per_unit: rate, value_paise: roundMoney(weight * rate) };
  });
  const diamondValue = diamondLines.reduce((sum, line) => sum + line.value_paise, 0);
  const stoneValue = stoneLines.reduce((sum, line) => sum + line.value_paise, 0);
  const totalDiamondCarats = item.diamonds.reduce((sum, diamond) => sum + diamond.weightMilliCarats / 1000, 0);
  const certificationValue = item.certified ? roundMoney(totalDiamondCarats * rates.certificationPaisePerCarat) : 0;
  const subtotal = goldValue + wastageValue + diamondValue + stoneValue + certificationValue;
  const gstValue = roundMoney(subtotal * rates.gstRateBp / 10000);
  const calculatedTotal = subtotal + gstValue;
  const finalPrice = method === 'direct' ? (agreedPricePaise ?? 0) : calculatedTotal;

  return {
    source: method,
    item_number: item.itemNumber,
    net_gold_g: netGoldGrams,
    purity_percent_bp: item.purityPercentBp,
    gold_rate_paise_per_g: rates.goldRatePaisePerGram,
    gold_value_paise: goldValue,
    wastage_mode: rates.wastageMode,
    wastage_value_paise: wastageValue,
    diamond_value_paise: diamondValue,
    stone_value_paise: stoneValue,
    certification_value_paise: certificationValue,
    subtotal_paise: subtotal,
    gst_rate_bp: rates.gstRateBp,
    gst_value_paise: gstValue,
    calculated_total_paise: calculatedTotal,
    agreed_price_paise: finalPrice,
    rates_snapshot: structuredClone(rates),
    diamond_lines: diamondLines,
    stone_lines: stoneLines,
  };
}

export function formatRupees(paise: number): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(paise / 100);
}
