/* wardrobeService — all wardrobe reads/writes in one place (brief §15).
   Thin async wrappers over the server actions: the server (and its
   database) stays the durable source of truth, React Query caches the
   reads, and the store mirrors them into the shared models. Keeping the
   calls here means no component assembles wardrobe requests by hand. */

import { api } from "../api";
import type { ClothingItem } from "../models";
import { toClothingItem, type ApiItem } from "./mappers";

export interface NewClothingInput {
  brand?: string;
  productUrl?: string | null;
  retailer?: string;
  name: string;
  category: string;
  slot: string;
  color: string;
  colorHex: string;
  pattern: string;
  material: string;
  style: string;
  season: string;
  formality: number;
  price: number;
  mrp: number | null;
  imageKey: string | null;
}

export const wardrobeService = {
  async listItems(userId: number): Promise<ClothingItem[]> {
    const res = await api.listItems({ userId });
    return res.items.map((row) => toClothingItem(row, userId));
  },

  /** Raw wire rows for components that still render the API shape. */
  async listItemRows(userId: number): Promise<ApiItem[]> {
    const res = await api.listItems({ userId });
    return res.items;
  },

  async addItem(userId: number, input: NewClothingInput): Promise<number> {
    const res = await api.addItem({
      userId,
      brand: input.brand ?? "",
      productUrl: input.productUrl ?? null,
      retailer: input.retailer ?? "",
      name: input.name,
      category: input.category,
      slot: input.slot,
      color: input.color,
      colorHex: input.colorHex,
      pattern: input.pattern,
      material: input.material,
      style: input.style,
      season: input.season,
      formality: input.formality,
      price: input.price,
      mrp: input.mrp,
      imageKey: input.imageKey,
    });
    return res.id;
  },

  async updateItem(
    userId: number,
    itemId: number,
    patch: Parameters<typeof api.updateItem>[0],
  ): Promise<void> {
    await api.updateItem({ ...patch, userId, itemId });
  },

  async deleteItem(userId: number, itemId: number): Promise<void> {
    await api.deleteItem({ userId, itemId });
  },

  /** markItemWorn / markOutfitWorn (§15/§16): one server call bumps
      timesWorn + lastWorn for every piece; analytics, cost-per-wear and
      insights all re-derive from the refreshed wardrobe. */
  async markWorn(userId: number, itemIds: number[]): Promise<void> {
    if (itemIds.length === 0) return;
    await api.wearOutfit({ userId, itemIds });
  },

  async toggleFavorite(userId: number, item: { id: number; favorite: boolean }): Promise<void> {
    await api.updateItem({ userId, itemId: item.id, favorite: !item.favorite });
  },

  async seedRealWardrobe(userId: number): Promise<number> {
    const res = await api.seedRealWardrobe({ userId });
    return res.count;
  },
};
