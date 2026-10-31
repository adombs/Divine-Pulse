import { useEffect, useState } from "react";
import { loadGameJson, onGameAssetsChange } from "./gameAssets";
import type { PortraitData } from "./personLookup";
export { expressionPaths, HURT_EXPRESSION, personFor } from "./personLookup";

export function usePortraitData(): PortraitData | null {
  const [data, setData] = useState<PortraitData | null>(null);
  useEffect(() => {
    let generation = 0;
    const load = () => {
      const current = ++generation;
      setData(null);
      void loadGameJson<PortraitData>("data/portraits.json").then((value) => {
        if (current === generation) setData(value);
      });
    };
    load();
    const off = onGameAssetsChange(load);
    return () => { generation++; off(); };
  }, []);
  return data;
}
