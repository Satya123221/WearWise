/* shoppingService — Smart Shop + brand directory (brief §7, §9).
   Products arrive in the shared Product model regardless of source, so
   a future official product API or affiliate feed only changes this
   file. Gap data comes from the same analyzeWardrobeGaps service the
   analytics page uses — one gap model, two consumers. */

import { api } from "../api";
import type { Product, WardrobeGap } from "../models";
import { toProduct, toWardrobeGap } from "./mappers";
import { wardrobeService } from "./wardrobeService";

export const shoppingService = {
  async recommendProducts(userId: number): Promise<{ products: Product[]; brandsInCatalog: number }> {
    const res = await api.recommendProducts({ userId });
    return { products: res.products.map(toProduct), brandsInCatalog: res.brandsInCatalog };
  },

  async listBrands(userId: number | null) {
    return api.listBrands(userId ? { userId } : {});
  },

  /** The shared gap list, in the WardrobeGap model (§9). */
  async getWardrobeGaps(userId: number): Promise<WardrobeGap[]> {
    const [res, wardrobe] = await Promise.all([
      api.getWardrobeGaps({ userId }),
      wardrobeService.listItems(userId),
    ]);
    return res.gaps.map((gap, i) => toWardrobeGap(gap, i, wardrobe));
  },
};
