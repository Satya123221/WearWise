/* Product — the shopping model (brief §7). Deliberately source-agnostic:
   `source` names wherever the listing came from (a retailer, an official
   product API, an affiliate feed) so the catalog can later be fed by any
   of them without changing consumers. */

export interface Product {
  id: string;
  name: string;
  /** Owned image key or null → colour tile; the real photo lives on the
      retailer's page (catalog CDN links expire, so they are not stored). */
  image: string | null;
  brand: string;
  category: string;
  slot: string;
  color: string;
  colorHex: string;
  style: string;
  price: number;
  mrp: number | null;
  currency: string; // "INR"
  source: string; // retailer / feed name
  productUrl: string;
  rating: number | null; // null = not rated by the source
  /** WearWise compatibility score vs the user's wardrobe, 0–100. */
  match: number | null;
  note: string;
}
