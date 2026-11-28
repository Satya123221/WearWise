import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { actionFields } from "@hatch/space-sdk/fields" with { type: "macro" };
import type { Actions } from "../../server/src/actions";
import { api, getSessionToken, setSessionToken, type ApiResponse } from "./api";

/* Form inputs take their limits (maxLength, minLength, min/max,
   required) from the server actions' request schemas — one source of
   truth, read at build time by the actionFields macro, so a form can
   never disagree with what its action accepts. */
const FIELDS = actionFields<typeof Actions>();
import { WearWiseProvider, useWearWise, useWearWiseOptional } from "./store/WearWiseProvider";
import { actions as storeActions } from "./store/actions";
import { storageService } from "./services/storageService";
import { wardrobeService } from "./services/wardrobeService";
import { aiService } from "./services/aiService";
import { FEEDBACK_REASONS, RATING_TO_FEEDBACK } from "./models";
import { confidenceLabel } from "./intelligence";
import heroImg from "./assets/hero.webp";
import overshirtImg from "./assets/overshirt.webp";
import blackteeImg from "./assets/blacktee.webp";

/* ------------------------------------------------------------------ */
/* Types + constants                                                   */
/* ------------------------------------------------------------------ */

type Item = ApiResponse<typeof api, "listItems">["items"][number];
type Outfit = ApiResponse<typeof api, "generateOutfit">["outfit"];
type Product = ApiResponse<typeof api, "recommendProducts">["products"][number];
type Analysis = ApiResponse<typeof api, "analyzePurchase">["analysis"];
type View = "home" | "dashboard" | "wardrobe" | "add" | "stylist" | "snap" | "buy" | "shop" | "brands" | "analytics" | "pack" | "profile" | "edge" | "intelligence";

const IMAGES: Record<string, string> = { hero: heroImg, overshirt: overshirtImg, blacktee: blackteeImg };
const OCCASIONS = ["College", "Casual", "Date", "Party", "Interview", "Wedding", "Travel", "Festive", "Gym"];
const WEATHERS = ["Cold", "Cool", "Warm", "Hot", "Rainy"];
const STYLES = ["Minimal", "Streetwear", "Smart Casual", "Classic", "Sporty", "Traditional", "Trendy"];
const SLOT_LABEL: Record<string, string> = { top: "Top", bottom: "Bottom", shoes: "Shoes", outerwear: "Layer", accessory: "Accessory", ethnic: "Ethnic" };
const inr = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");

/* Indian pricing: selling price, MRP (when a real one is listed), and the
   discount % between them. Discount is computed, never stored or invented —
   when mrp is null or not above the price, only the selling price shows. */
function discountPctOf(price: number, mrp?: number | null): number {
  if (!mrp || mrp <= price || price <= 0) return 0;
  return Math.round((1 - price / mrp) * 100);
}

function PriceBlock({ price, mrp, big = false }: { price: number; mrp?: number | null; big?: boolean }) {
  const pct = discountPctOf(price, mrp);
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className={big ? "text-xl font-bold" : "text-sm font-bold"} style={{ color: "var(--text)" }}>{inr(price)}</span>
      {pct > 0 && mrp ? (
        <>
          <span className="text-xs line-through" style={{ color: "var(--faint)" }}>MRP {inr(mrp)}</span>
          <span className="rounded-full px-1.5 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in srgb, var(--sage) 22%, transparent)", color: "var(--sage)" }}>{pct}% OFF</span>
        </>
      ) : null}
    </span>
  );
}

/* Editable garment taxonomy — used by both the scan-result form and the
   wardrobe Edit dialog so a wrong guess can always be corrected. */
const CATEGORY_OPTIONS = ["Shirt", "T-Shirt", "Hoodie", "Overshirt", "Jacket", "Blazer", "Jeans", "Chinos", "Trousers", "Sneakers", "Running Shoes", "Shoes", "Loafers", "Kurta", "Kurta Set", "Nehru Jacket", "Sherwani", "Saree", "Lehenga", "Ethnic Set", "Jutti", "Mojari", "Accessory"];
/* Phase 2 fields: fit + the occasions a piece is for. Shared by the scan
   form and the Wardrobe Edit dialog, stored on the item itself. */
const FIT_OPTIONS = ["Slim", "Regular", "Relaxed", "Oversized"];
const ITEM_OCCASIONS = ["College", "Casual", "Date", "Party", "Interview", "Wedding", "Travel", "Festive", "Diwali", "Eid", "Family Function", "Traditional Event", "Gym"];
const COLOR_OPTIONS: Array<{ name: string; hex: string }> = [
  { name: "Black", hex: "#1b1b1e" }, { name: "White", hex: "#f4f1ea" }, { name: "Navy", hex: "#24365e" },
  { name: "Blue", hex: "#2c4460" }, { name: "Cream", hex: "#e7dcc3" }, { name: "Beige", hex: "#cbb894" },
  { name: "Olive", hex: "#5c6644" }, { name: "Grey", hex: "#8a8a8f" }, { name: "Charcoal", hex: "#3a3a40" },
  { name: "Brown", hex: "#6d4a2f" }, { name: "Green", hex: "#3f6212" }, { name: "Red", hex: "#a33327" },
  { name: "Yellow", hex: "#d9a441" }, { name: "Teal", hex: "#2e5f5d" },
];
const PATTERN_OPTIONS = ["Solid", "Striped", "Checked", "Printed", "Colour Block", "Textured", "Embroidered", "Washed", "Jacquard"];
const MATERIAL_OPTIONS = ["Cotton", "Cotton Oxford", "Cotton Poplin", "Cotton Twill", "Heavy Cotton", "Cotton Jersey", "Denim", "Stretch Denim", "Leather", "Mesh", "Wool Blend", "Silk Blend", "Cotton Blend", "Poly-Viscose", "Suede", "Linen", "Jacquard Weave", "Velvet Blend", "Woven Cotton"];
const STYLE_OPTIONS = ["Casual", "Smart Casual", "Classic", "Minimal", "Streetwear", "Sporty", "Traditional", "Trendy"];
const SEASON_OPTIONS = ["All Season", "Summer", "Winter", "Monsoon"];

function colorHexFor(name: string, fallback = "#888888"): string {
  return COLOR_OPTIONS.find((c) => c.name.toLowerCase() === name.trim().toLowerCase())?.hex ?? fallback;
}
function slotForCategory(category: string, fallback = "top"): string {
  const c = category.toLowerCase();
  if (c.includes("kurta") || c.includes("sherwani") || c.includes("ethnic") || c.includes("saree") || c.includes("lehenga")) return "ethnic";
  if (c.includes("jean") || c.includes("chino") || c.includes("trouser") || c.includes("pant") || c.includes("short")) return "bottom";
  if (c.includes("sneaker") || c.includes("shoe") || c.includes("loafer") || c.includes("sandal") || c.includes("boot") || c.includes("jutti") || c.includes("mojari")) return "shoes";
  if (c.includes("jacket") || c.includes("blazer") || c.includes("overshirt") || c.includes("coat") || c.includes("nehru")) return "outerwear";
  if (c.includes("watch") || c.includes("belt") || c.includes("cap") || c.includes("accessor") || c.includes("bag") || c.includes("sunglass")) return "accessory";
  if (c.includes("shirt") || c.includes("tee") || c.includes("hoodie") || c.includes("sweater") || c.includes("polo") || c.includes("top")) return "top";
  return fallback;
}
function withCurrent(options: string[], current: string): string[] {
  return current && !options.includes(current) ? [current, ...options] : options;
}

/* ------------------------------------------------------------------ */
/* Uploaded photos                                                     */
/*                                                                     */
/* A picked or dropped photo is downscaled in the browser (longest     */
/* edge 1200px, re-encoded as JPEG) before it is sent, so a multi-MB   */
/* phone photo becomes a few hundred KB that loads fast everywhere.   */
/* The result goes to addItem / updateItem as base64; the server       */
/* re-validates the bytes itself (magic bytes, not the claimed type)   */
/* and stores them per-account. The photo is never "analysed" — the    */
/* scan stays a labelled starting guess either way.                    */
/* ------------------------------------------------------------------ */

type UploadedPhoto = { dataBase64: string; mimeType: string };

function processPhotoFile(file: File): Promise<UploadedPhoto> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) {
      reject(new Error("That file isn't an image — pick a photo (JPEG, PNG or WebP)."));
      return;
    }
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      try {
        const maxEdge = 1200;
        const scale = Math.min(1, maxEdge / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * scale));
        const h = Math.max(1, Math.round(img.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const cx = canvas.getContext("2d");
        if (!cx) throw new Error("canvas unavailable");
        cx.drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
        resolve({ dataBase64: dataUrl.slice(dataUrl.indexOf(",") + 1), mimeType: "image/jpeg" });
      } catch {
        URL.revokeObjectURL(url);
        reject(new Error("That photo couldn't be processed — try a different one."));
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("That photo couldn't be read — it may be damaged, or a format this browser can't open (like HEIC). Try a JPEG or PNG."));
    };
    img.src = url;
  });
}

/* ------------------------------------------------------------------ */
/* Small utilities                                                     */
/* ------------------------------------------------------------------ */

/* Safe storage lives in services/storageService.ts — the single
   persistence gateway (guarded localStorage + in-memory fallback for
   sandboxed webviews). Components never touch localStorage directly. */
const safeStore = storageService;

function useReveal() {
  useEffect(() => {
    const els = document.querySelectorAll(".reveal");
    // No IntersectionObserver (old webview): show everything at once
    // instead of leaving sections stuck at opacity 0 forever.
    if (typeof IntersectionObserver === "undefined") {
      els.forEach((el) => el.classList.add("is-in"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("is-in"); io.unobserve(e.target); } }),
      { threshold: 0.12 },
    );
    els.forEach((el) => io.observe(el));
    // Safety net: nothing may stay invisible if the observer never fires.
    const fallback = setTimeout(() => {
      document.querySelectorAll(".reveal:not(.is-in)").forEach((el) => el.classList.add("is-in"));
    }, 2500);
    return () => { io.disconnect(); clearTimeout(fallback); };
  });
}

function useCounter(target: number, active: boolean, ms = 1200) {
  const [v, setV] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0; const t0 = performance.now();
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / ms);
      setV(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [target, active, ms]);
  return v;
}

function ScoreRing({ score, size = 120, label }: { score: number; size?: number; label?: string }) {
  const r = 46; const c = 2 * Math.PI * r;
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} role="img" aria-label={`${label ?? "Score"}: ${score} percent`}>
      <svg viewBox="0 0 110 110" width={size} height={size} className="-rotate-90">
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--border)" strokeWidth="7" />
        <circle cx="55" cy="55" r={r} fill="none" stroke="var(--accent)" strokeWidth="7" strokeLinecap="round"
          strokeDasharray={c} strokeDashoffset={c - (c * score) / 100} className="ring-anim" style={{ strokeDasharray: c }} />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-display text-3xl leading-none" style={{ color: "var(--text)" }}>{score}%</span>
        {label ? <span className="mt-1 text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: "var(--dim)" }}>{label}</span> : null}
      </div>
    </div>
  );
}

function Bar({ pct, color }: { pct: number; color?: string }) {
  const [w, setW] = useState(0);
  useEffect(() => { const t = setTimeout(() => setW(pct), 60); return () => clearTimeout(t); }, [pct]);
  return (
    <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--border)" }}>
      <div className="h-full rounded-full" style={{ width: `${w}%`, background: color ?? "var(--accent)", transition: "width 1s cubic-bezier(.22,.8,.32,1)" }} />
    </div>
  );
}

function Toast({ msg }: { msg: string | null }) {
  if (!msg) return null;
  return (
    <div className="anim-pop fixed left-1/2 bottom-24 md:bottom-8 z-[90] -translate-x-1/2 rounded-full px-5 py-3 text-sm font-semibold shadow-2xl"
      style={{ background: "var(--text)", color: "var(--bg)" }} role="status">{msg}</div>
  );
}

/* ------------------------------------------------------------------ */
/* Clothing visuals                                                    */
/* ------------------------------------------------------------------ */

function ItemVisual({ item, className = "" }: { item: Item; className?: string }) {
  /* The user's own saved photo wins over the stock imageKey visual.
     If it fails to load (missing/corrupt stored photo), fall back to
     the imageKey / colour tile instead of a broken image. */
  const [photoBroken, setPhotoBroken] = useState(false);
  useEffect(() => { setPhotoBroken(false); }, [item.photoUrl]);
  if (item.photoUrl && !photoBroken) {
    return <img src={item.photoUrl} alt={item.name} className={`h-full w-full object-cover ${className}`} loading="lazy" onError={() => setPhotoBroken(true)} />;
  }
  const src = item.imageKey ? IMAGES[item.imageKey] : undefined;
  if (src) return <img src={src} alt={item.name} className={`h-full w-full object-cover ${className}`} loading="lazy" />;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center" style={{ background: `linear-gradient(150deg, ${item.colorHex}, ${item.colorHex}cc 55%, #00000055)` }} aria-hidden="true">
      <span className="font-display text-3xl italic leading-none" style={{ color: "rgba(255,255,255,.9)", textShadow: "0 2px 12px rgba(0,0,0,.4)" }}>{(item.brand || item.name).charAt(0)}</span>
      <span className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(255,255,255,.8)" }}>{item.brand || item.category}</span>
      <span className="text-[9px] font-semibold tracking-[0.14em] uppercase" style={{ color: "rgba(255,255,255,.6)" }}>{item.category} · {item.color}</span>
    </div>
  );
}

function ItemCard({ item, onWear, onToggleFav, onEdit, onDelete, onFindOutfits, busy }: {
  item: Item;
  onWear?: (i: Item) => void; onToggleFav?: (i: Item) => void;
  onEdit?: (i: Item) => void; onDelete?: (i: Item) => void; onFindOutfits?: (i: Item) => void;
  busy?: boolean;
}) {
  const [show, setShow] = useState(false);
  return (
    <article className="card-lift group relative overflow-hidden rounded-2xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}
      onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <button type="button" className="block aspect-[4/3] w-full cursor-pointer overflow-hidden p-0" aria-label={`Details for ${item.name}`} aria-expanded={show} onClick={() => setShow((s) => !s)}>
        <ItemVisual item={item} />
      </button>
      {item.favorite ? <span className="absolute top-3 left-3 rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>FAVOURITE</span> : null}
      <div className={`absolute inset-x-0 top-0 aspect-[4/3] flex flex-col justify-end gap-1 p-4 transition-opacity duration-300 ${show ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        style={{ background: "linear-gradient(to top, rgba(5,5,8,.88), rgba(5,5,8,.25) 60%, transparent)" }} aria-hidden={!show}>
        <p className="text-xs text-white/85">{item.outfitCount} outfit pairings · {item.wornCount} wears</p>
        <p className="text-xs text-white/85">{item.daysSinceWorn === null ? "Never worn yet" : item.daysSinceWorn === 0 ? "Worn today" : `Last worn ${item.daysSinceWorn}d ago`} · {inr(item.costPerWear)}/wear</p>
        <p className="text-xs text-white/60">{item.material} · {item.pattern} · {item.season}</p>
        <p className="text-xs text-white/60">{item.fit} fit{item.occasions.length ? ` · for ${item.occasions.slice(0, 3).join(", ")}` : ""}</p>
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            {item.brand ? <p className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>{item.brand}</p> : null}
            <h3 className="font-semibold leading-tight" style={{ color: "var(--text)" }}>{item.name}</h3>
            <p className="mt-0.5 text-xs" style={{ color: "var(--dim)" }}>{item.color} · {item.style}</p>
            <p className="mt-1"><PriceBlock price={item.price} mrp={item.mrp} /></p>
            {item.productUrl ? <a href={item.productUrl} target="_blank" rel="noreferrer" className="mt-1 inline-block text-[11px] font-bold underline underline-offset-2" style={{ color: "var(--accent)" }}>View on {item.retailer || "retailer"} ↗</a> : null}
          </div>
          <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border" style={{ background: item.colorHex, borderColor: "var(--border)" }} aria-label={`Colour ${item.color}`} />
        </div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {onWear ? <button type="button" disabled={busy} onClick={() => onWear(item)} className="btn-lift rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Wear today</button> : null}
          {onFindOutfits ? <button type="button" onClick={() => onFindOutfits(item)} className="btn-lift rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Find outfits</button> : null}
          {onToggleFav ? <button type="button" onClick={() => onToggleFav(item)} className="btn-lift rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: item.favorite ? "var(--accent)" : "var(--text)" }} aria-pressed={item.favorite}>{item.favorite ? "★ Saved" : "☆ Save"}</button> : null}
          {onEdit ? <button type="button" onClick={() => onEdit(item)} className="btn-lift rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Edit</button> : null}
          {onDelete ? <button type="button" onClick={() => onDelete(item)} className="btn-lift rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--danger)" }}>Remove</button> : null}
        </div>
      </div>
    </article>
  );
}

function OutfitStrip({ outfit, compact = false }: { outfit: Outfit; compact?: boolean }) {
  return (
    <div className={`flex gap-3 overflow-x-auto no-scrollbar snap-x ${compact ? "" : "py-1"}`}>
      {outfit.items.map((it, idx) => (
        <div key={it.id} className="anim-pop snap-start shrink-0" style={{ animationDelay: `${idx * 110}ms`, width: compact ? 104 : 128 }}>
          <div className="aspect-[3/4] overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}>
            <ItemVisual item={it} />
          </div>
          <p className="mt-2 text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--accent)" }}>{SLOT_LABEL[it.slot] ?? it.slot}</p>
          <p className="text-xs font-semibold leading-tight" style={{ color: "var(--text)" }}>{it.name}</p>
        </div>
      ))}
    </div>
  );
}

function FactorBars({ outfit }: { outfit: Outfit }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {outfit.factors.map((f) => (
        <div key={f.label}>
          <div className="mb-1 flex items-center justify-between text-xs">
            <span style={{ color: "var(--dim)" }}>{f.label}</span>
            <span className="font-bold" style={{ color: "var(--text)" }}>{f.score}%</span>
          </div>
          <Bar pct={f.score} />
        </div>
      ))}
    </div>
  );
}

/* Reusable AI processing experience — cycles honest step labels with a
   progress shimmer while a service runs. Short by design: the parent
   controls how long it shows, and it never pretends to be a real model
   call taking longer than it does. */
function AiSteps({ steps, title }: { steps: string[]; title?: string }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    const t = setInterval(() => setIdx((i) => Math.min(steps.length - 1, i + 1)), 620);
    return () => clearInterval(t);
  }, [steps]);
  return (
    <div className="anim-fade-up py-4" role="status" aria-live="polite">
      {title ? <p className="font-display text-2xl italic" style={{ color: "var(--text)" }}>{title}</p> : null}
      <ul className="mt-4 grid gap-2.5">
        {steps.map((s, i) => (
          <li key={s} className="flex items-center gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: i === idx ? "var(--accent)" : "var(--border)", background: "var(--surface)", opacity: i < idx ? 0.65 : i === idx ? 1 : 0.4, transition: "opacity .35s, border-color .35s" }}>
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: i < idx ? "var(--sage)" : i === idx ? "var(--accent)" : "var(--border)", color: i < idx ? "#0d120a" : i === idx ? "var(--accent-ink)" : "var(--dim)" }}>{i < idx ? "✓" : i === idx ? "✦" : "·"}</span>
            <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{s}{i === idx ? "…" : ""}</span>
            {i === idx ? <span className="ml-auto h-1.5 w-16 overflow-hidden rounded-full" style={{ background: "var(--border)" }} aria-hidden="true"><span className="block h-full w-1/2 rounded-full" style={{ background: "var(--accent)", animation: "shimmer 1.1s linear infinite", backgroundSize: "200% 100%" }} /></span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ChipRow({ options, value, onChange, label }: { options: string[]; value: string; onChange: (v: string) => void; label: string }) {
  return (
    <fieldset>
      <legend className="mb-2 text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)" }}>{label}</legend>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o} type="button" role="radio" aria-checked={value === o} onClick={() => onChange(o)}
            className="btn-lift rounded-full border px-4 py-2 text-sm font-semibold"
            style={value === o
              ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" }
              : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
            {o}
          </button>
        ))}
      </div>
    </fieldset>
  );
}

function GarmentSelect({ id, label, value, onChange, options }: { id: string; label: string; value: string; onChange: (v: string) => void; options: string[] }) {
  const inputCls = "w-full rounded-xl border px-3.5 py-2.5 text-sm";
  const inputStyle = { background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" } as const;
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} style={inputStyle} aria-label={label}>
        {withCurrent(options, value).map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
    </div>
  );
}

/* Multi-select occasion chips — the occasions a piece is for, stored on
   the item and used by the stylist, Style DNA and gap analysis. */
function OccasionChips({ label, value, onChange }: { label: string; value: string[]; onChange: (v: string[]) => void }) {
  const toggle = (occ: string) => onChange(value.includes(occ) ? value.filter((o) => o !== occ) : [...value, occ]);
  return (
    <fieldset>
      <legend className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>{label}</legend>
      <div className="flex flex-wrap gap-1.5">
        {ITEM_OCCASIONS.map((occ) => {
          const on = value.includes(occ);
          return (
            <button key={occ} type="button" onClick={() => toggle(occ)} aria-pressed={on}
              className="btn-lift rounded-full border px-3 py-1.5 text-xs font-semibold"
              style={on ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface-2)" }}>
              {occ}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function SectionHead({ kicker, title, sub }: { kicker: string; title: ReactNode; sub?: string }) {
  return (
    <div className="reveal mx-auto max-w-2xl text-center">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>{kicker}</p>
      <h2 className="font-display mt-3 text-4xl leading-[1.05] font-medium md:text-5xl" style={{ color: "var(--text)" }}>{title}</h2>
      {sub ? <p className="mt-4 text-base leading-relaxed" style={{ color: "var(--dim)" }}>{sub}</p> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Auth modal                                                          */
/* ------------------------------------------------------------------ */

type AuthSubmit = { mode: "login" | "register"; name: string; email: string; password: string };

function AuthModal({ open, onClose, onLogin, onDemo, busy, error }: {
  open: boolean; onClose: () => void;
  onLogin: (a: AuthSubmit) => void; onDemo: () => void; busy: boolean; error: string | null;
}) {
  const [mode, setMode] = useState<"login" | "register">("login");
  const [name, setName] = useState("Satyajeet");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  if (!open) return null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) { setFormError("Enter your email and password to continue."); return; }
    setFormError(null);
    onLogin({ mode, name: name.trim() || "Friend", email: email.trim(), password });
  };
  const tabCls = "btn-lift flex-1 rounded-full py-2 text-sm font-bold";
  const tabStyle = (active: boolean) => active
    ? { background: "var(--accent)", color: "var(--accent-ink)" }
    : { color: "var(--dim)" };
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="Log in to WearWise">
      <button type="button" aria-label="Close login" className="absolute inset-0 h-full w-full cursor-default" style={{ background: "rgba(4,4,6,.72)", backdropFilter: "blur(6px)" }} onClick={onClose} />
      <div className="anim-pop relative w-full max-w-md rounded-t-3xl sm:rounded-3xl border p-7" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
        <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Welcome to WearWise</p>
        <h2 className="font-display mt-2 text-3xl font-medium" style={{ color: "var(--text)" }}>Your wardrobe is waiting.</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>
          {mode === "register"
            ? "Create your account with a password. New accounts start with a wardrobe of real branded pieces — Nike, Levi’s, H&M, Allen Solly, Manyavar and more, at real prices — then make it yours."
            : "Log in with your email and password. Signed in before passwords existed? Your first password login sets a password for your existing account and signs you in."}
        </p>
        <div className="mt-5 flex gap-1 rounded-full border p-1" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }} role="tablist" aria-label="Log in or create account">
          <button type="button" role="tab" aria-selected={mode === "login"} onClick={() => setMode("login")} className={tabCls} style={tabStyle(mode === "login")}>Log In</button>
          <button type="button" role="tab" aria-selected={mode === "register"} onClick={() => setMode("register")} className={tabCls} style={tabStyle(mode === "register")}>Create Account</button>
        </div>
        <form className="mt-5 grid gap-4" onSubmit={submit}>
          {mode === "register" ? (
            <div>
              <label htmlFor="auth-name" className="mb-1.5 block text-xs font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Your name</label>
              <input id="auth-name" {...FIELDS.register.name} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name"
                className="w-full rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
            </div>
          ) : null}
          <div>
            <label htmlFor="auth-email" className="mb-1.5 block text-xs font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Email</label>
            <input id="auth-email" {...FIELDS.login.email} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com"
              className="w-full rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
          </div>
          <div>
            <label htmlFor="auth-password" className="mb-1.5 block text-xs font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Password</label>
            {mode === "register" ? (
              <input id="auth-password" {...FIELDS.register.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password" placeholder="At least 8 characters"
                className="w-full rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
            ) : (
              <input id="auth-password" {...FIELDS.login.password} type="password" value={password} onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password" placeholder="Your password"
                className="w-full rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
            )}
          </div>
          {(error ?? formError) ? <p className="text-sm" style={{ color: "var(--danger)" }} role="alert">{error ?? formError}</p> : null}
          <button type="submit" disabled={busy} className="btn-lift rounded-full py-3 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            {busy ? "Signing you in…" : mode === "register" ? "Create Account" : "Log In"}
          </button>
          <button type="button" disabled={busy} onClick={onDemo}
            className="btn-lift rounded-full border py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
            Continue with the demo account
          </button>
        </form>
        <p className="mt-4 text-center text-xs leading-relaxed" style={{ color: "var(--faint)" }}>
          Passwords are hashed on the server (PBKDF2) and never stored in plain text; every request is checked against your server session. The one-tap demo account is shared and has no password.
        </p>
      </div>
    </div>
  );
}

/* The server's auth errors are written for people; the transport wraps
   them, so match on the server's own phrases and fall back to a plain
   retry message rather than surfacing transport detail. */
function authErrorMessage(e: unknown): string {
  const text = e instanceof Error ? e.message : String(e);
  const phrases = [
    "Incorrect email or password", "Too many sign-in attempts", "already exists",
    "demo account", "at least 8 characters", "session has expired",
  ];
  for (const p of phrases) {
    const at = text.indexOf(p);
    if (at >= 0) {
      const sentence = text.slice(at).split(/(?<=[.!?])\s/)[0] ?? p;
      return sentence.length <= 180 ? sentence : `${sentence.slice(0, 177)}…`;
    }
  }
  return "Something went wrong signing you in — check your connection and try again.";
}

/* ------------------------------------------------------------------ */
/* Landing page                                                        */
/* ------------------------------------------------------------------ */

const CLOSET_PREVIEW = [
  { label: "T-Shirts", count: 18, most: "PUMA T7 Tee", least: "Roadster Printed Tee", color: "Black" },
  { label: "Shirts", count: 14, most: "Tommy Hilfiger Oxford Shirt", least: "Allen Solly Striped Shirt", color: "Navy" },
  { label: "Pants", count: 9, most: "Being Human Chinos", least: "Van Heusen Trousers", color: "Beige" },
  { label: "Jeans", count: 8, most: "Levi’s 511 Jeans", least: "Jack & Jones Jeans", color: "Blue" },
  { label: "Shoes", count: 11, most: "GUESS Leather Sneakers", least: "Adidas Questar 3", color: "White" },
  { label: "Jackets", count: 7, most: "Peter England Blazer", least: "Mast & Harbour Denim Jacket", color: "Black" },
  { label: "Ethnic", count: 20, most: "Manyavar Kurta Set", least: "Pantaloons Kurta", color: "Blue" },
];
type UseCasePiece = { slot: string; name: string; brand: string; color: string; colorHex: string };
type UseCase = {
  icon: string; label: string; stylistOccasion: string;
  headline: string; vibe: string; tip: string;
  formality: number; baseMatch: number;
  palette: Array<{ name: string; hex: string }>;
  looks: UseCasePiece[][];
};
const USE_CASES: UseCase[] = [
  {
    icon: "🎓", label: "College", stylistOccasion: "College",
    headline: "Sharp for the 9am lecture, comfortable till the last one",
    vibe: "Relaxed layers that look put-together without trying — breathable, easy to repeat, and presentation-ready when your name gets called.",
    tip: "Swap the tee for the Oxford shirt and the same chinos instantly read as presentation-ready.",
    formality: 2, baseMatch: 92,
    palette: [{ name: "Navy", hex: "#24365e" }, { name: "White", hex: "#f4f1ea" }, { name: "Beige", hex: "#cbb894" }],
    looks: [
      [
        { slot: "Top", name: "Oxford Shirt", brand: "Tommy Hilfiger", color: "Navy", colorHex: "#24365e" },
        { slot: "Bottom", name: "Stretch Chinos", brand: "Being Human", color: "Beige", colorHex: "#cbb894" },
        { slot: "Shoes", name: "Court Sneakers", brand: "Pepe Jeans", color: "White", colorHex: "#f4f1ea" },
      ],
      [
        { slot: "Top", name: "T7 Graphic Tee", brand: "PUMA", color: "Black", colorHex: "#1b1b1e" },
        { slot: "Bottom", name: "511 Slim Jeans", brand: "Levi's", color: "Blue", colorHex: "#2c4460" },
        { slot: "Shoes", name: "Revolution 8", brand: "Nike", color: "Black", colorHex: "#1b1b1e" },
      ],
    ],
  },
  {
    icon: "💼", label: "Work", stylistOccasion: "Casual",
    headline: "Clean, credible, and comfortable through back-to-back meetings",
    vibe: "Smart-casual structure — a proper collar, tailored trousers, and shoes that say you meant it. No tie, no stiffness.",
    tip: "Keep one blazer at your desk: it upgrades this exact outfit for any surprise client call.",
    formality: 4, baseMatch: 90,
    palette: [{ name: "Navy", hex: "#24365e" }, { name: "Charcoal", hex: "#3a3a40" }, { name: "White", hex: "#f4f1ea" }],
    looks: [
      [
        { slot: "Top", name: "Slim Fit Shirt", brand: "Allen Solly", color: "Olive", colorHex: "#5c6644" },
        { slot: "Bottom", name: "Formal Trousers", brand: "Van Heusen", color: "Charcoal", colorHex: "#3a3a40" },
        { slot: "Shoes", name: "Leather Sneakers", brand: "GUESS", color: "Black", colorHex: "#1b1b1e" },
      ],
      [
        { slot: "Top", name: "Oxford Shirt", brand: "H&M", color: "White", colorHex: "#f4f1ea" },
        { slot: "Bottom", name: "Stretch Chinos", brand: "Being Human", color: "Beige", colorHex: "#cbb894" },
        { slot: "Layer", name: "Single-Breasted Blazer", brand: "Peter England", color: "Navy", colorHex: "#24365e" },
      ],
    ],
  },
  {
    icon: "🎤", label: "Interviews", stylistOccasion: "Interview",
    headline: "The outfit that lets the panel hear you, not your clothes",
    vibe: "Maximum polish, zero distraction. Fitted, neutral, and pressed — confidence they notice before you say a word.",
    tip: "Stick to one accent colour max. In interviews, restraint reads as competence.",
    formality: 5, baseMatch: 94,
    palette: [{ name: "White", hex: "#f4f1ea" }, { name: "Navy", hex: "#24365e" }, { name: "Black", hex: "#1b1b1e" }],
    looks: [
      [
        { slot: "Top", name: "Oxford Shirt", brand: "Tommy Hilfiger", color: "White", colorHex: "#f4f1ea" },
        { slot: "Bottom", name: "Formal Trousers", brand: "Van Heusen", color: "Navy", colorHex: "#24365e" },
        { slot: "Layer", name: "Jacquard Blazer", brand: "Marks & Spencer", color: "Black", colorHex: "#1b1b1e" },
      ],
      [
        { slot: "Top", name: "Striped Shirt", brand: "Allen Solly", color: "Blue", colorHex: "#2c4460" },
        { slot: "Bottom", name: "Stretch Chinos", brand: "Being Human", color: "Beige", colorHex: "#cbb894" },
        { slot: "Shoes", name: "Leather Sneakers", brand: "GUESS", color: "Black", colorHex: "#1b1b1e" },
      ],
    ],
  },
  {
    icon: "🎉", label: "Parties", stylistOccasion: "Party",
    headline: "One statement piece. Everything else backs it up.",
    vibe: "After-dark energy — darker palette, a texture or print that catches the light, and shoes you can actually stay out in.",
    tip: "Let one piece talk — printed shirt OR statement sneakers, never both at full volume.",
    formality: 3, baseMatch: 91,
    palette: [{ name: "Black", hex: "#1b1b1e" }, { name: "Olive", hex: "#5c6644" }, { name: "Cream", hex: "#e7dcc3" }],
    looks: [
      [
        { slot: "Top", name: "Overshirt", brand: "Zara", color: "Cream", colorHex: "#e7dcc3" },
        { slot: "Bottom", name: "511 Slim Jeans", brand: "Levi's", color: "Black", colorHex: "#1b1b1e" },
        { slot: "Shoes", name: "Leather Sneakers", brand: "GUESS", color: "Black", colorHex: "#1b1b1e" },
      ],
      [
        { slot: "Top", name: "Denim Jacket", brand: "Mast & Harbour", color: "Blue", colorHex: "#2c4460" },
        { slot: "Bottom", name: "511 Slim Jeans", brand: "Levi's", color: "Blue", colorHex: "#2c4460" },
        { slot: "Shoes", name: "Questar 3", brand: "Adidas", color: "White", colorHex: "#f4f1ea" },
      ],
    ],
  },
  {
    icon: "🌹", label: "Dates", stylistOccasion: "Date",
    headline: "Effortless on purpose — polished, never overdressed",
    vibe: "Soft contrast and a fit that moves with you. The goal is 'you look great' — not 'you tried very hard'.",
    tip: "A cream or olive layer over a dark base is the most complimented combination in your wardrobe.",
    formality: 3, baseMatch: 94,
    palette: [{ name: "Cream", hex: "#e7dcc3" }, { name: "Black", hex: "#1b1b1e" }, { name: "Olive", hex: "#5c6644" }],
    looks: [
      [
        { slot: "Top", name: "Overshirt", brand: "Zara", color: "Cream", colorHex: "#e7dcc3" },
        { slot: "Bottom", name: "511 Slim Jeans", brand: "Levi's", color: "Black", colorHex: "#1b1b1e" },
        { slot: "Shoes", name: "Court Sneakers", brand: "Pepe Jeans", color: "White", colorHex: "#f4f1ea" },
      ],
      [
        { slot: "Top", name: "Oxford Shirt", brand: "Tommy Hilfiger", color: "Navy", colorHex: "#24365e" },
        { slot: "Bottom", name: "Stretch Chinos", brand: "Being Human", color: "Beige", colorHex: "#cbb894" },
        { slot: "Shoes", name: "Leather Sneakers", brand: "GUESS", color: "Black", colorHex: "#1b1b1e" },
      ],
    ],
  },
  {
    icon: "💍", label: "Weddings", stylistOccasion: "Wedding",
    headline: "Celebration dressing — rich colour, proper occasion energy",
    vibe: "This is where your ethnic pieces earn their place. A kurta set with structure, or a blazer look that respects the room.",
    tip: "For day functions go lighter (cream, sky); after sunset, navy and black carry the room.",
    formality: 5, baseMatch: 93,
    palette: [{ name: "Blue", hex: "#2c4460" }, { name: "Cream", hex: "#e7dcc3" }, { name: "Yellow", hex: "#d9a441" }],
    looks: [
      [
        { slot: "Ethnic", name: "Kurta Set", brand: "Manyavar", color: "Blue", colorHex: "#2c4460" },
        { slot: "Shoes", name: "Leather Sneakers", brand: "GUESS", color: "Black", colorHex: "#1b1b1e" },
        { slot: "Layer", name: "Jacquard Blazer", brand: "Marks & Spencer", color: "Black", colorHex: "#1b1b1e" },
      ],
      [
        { slot: "Ethnic", name: "Festive Kurta", brand: "SOURAGYA", color: "Yellow", colorHex: "#d9a441" },
        { slot: "Bottom", name: "Formal Trousers", brand: "Van Heusen", color: "Cream", colorHex: "#e7dcc3" },
        { slot: "Shoes", name: "Court Sneakers", brand: "Pepe Jeans", color: "White", colorHex: "#f4f1ea" },
      ],
    ],
  },
  {
    icon: "✈️", label: "Travel", stylistOccasion: "Travel",
    headline: "Three pieces, five outfits, one cabin bag",
    vibe: "Everything here mixes with everything else. Wrinkle-friendly fabrics, layers for cabin-to-street temperature swings.",
    tip: "Wear your heaviest piece — the jacket — on the flight. Your bag thanks you, and cabins are cold anyway.",
    formality: 2, baseMatch: 89,
    palette: [{ name: "Olive", hex: "#5c6644" }, { name: "Beige", hex: "#cbb894" }, { name: "Black", hex: "#1b1b1e" }],
    looks: [
      [
        { slot: "Top", name: "Slim Fit Shirt", brand: "Allen Solly", color: "Olive", colorHex: "#5c6644" },
        { slot: "Bottom", name: "Stretch Chinos", brand: "Being Human", color: "Beige", colorHex: "#cbb894" },
        { slot: "Shoes", name: "Revolution 8", brand: "Nike", color: "Black", colorHex: "#1b1b1e" },
      ],
      [
        { slot: "Top", name: "T7 Graphic Tee", brand: "PUMA", color: "Black", colorHex: "#1b1b1e" },
        { slot: "Bottom", name: "511 Slim Jeans", brand: "Levi's", color: "Blue", colorHex: "#2c4460" },
        { slot: "Layer", name: "Denim Jacket", brand: "Mast & Harbour", color: "Blue", colorHex: "#2c4460" },
      ],
    ],
  },
  {
    icon: "☀️", label: "Everyday", stylistOccasion: "Casual",
    headline: "Your default, upgraded — the 30-second morning decision",
    vibe: "The pieces you reach for anyway, combined on purpose. Neutral base, one colour, done. This is where cost-per-wear is won.",
    tip: "Rotate your top, keep the base. Same jeans and sneakers, three different days, nobody notices.",
    formality: 1, baseMatch: 90,
    palette: [{ name: "Black", hex: "#1b1b1e" }, { name: "White", hex: "#f4f1ea" }, { name: "Blue", hex: "#2c4460" }],
    looks: [
      [
        { slot: "Top", name: "Crew Tee", brand: "Nobero", color: "Black", colorHex: "#1b1b1e" },
        { slot: "Bottom", name: "511 Slim Jeans", brand: "Levi's", color: "Blue", colorHex: "#2c4460" },
        { slot: "Shoes", name: "Revolution 8", brand: "Nike", color: "White", colorHex: "#f4f1ea" },
      ],
      [
        { slot: "Top", name: "Oxford Shirt", brand: "H&M", color: "White", colorHex: "#f4f1ea" },
        { slot: "Bottom", name: "Stretch Chinos", brand: "Being Human", color: "Beige", colorHex: "#cbb894" },
        { slot: "Shoes", name: "Questar 3", brand: "Adidas", color: "White", colorHex: "#f4f1ea" },
      ],
    ],
  },
];

function Landing({ go, openAuth, items }: { go: (v: View) => void; openAuth: () => void; items: Item[] }) {
  useReveal();
  const heroRef = useRef<HTMLDivElement>(null);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });
  const [closet, setCloset] = useState(1);
  const [step, setStep] = useState(1);
  const [useCaseIdx, setUseCaseIdx] = useState(0);
  const [useCaseLook, setUseCaseLook] = useState(0);
  const [savedUseCases, setSavedUseCases] = useState<Set<string>>(new Set());
  const heroItems = items.slice(0, 3);
  const closetActive = CLOSET_PREVIEW[closet] ?? CLOSET_PREVIEW[0]!;
  const activeUseCase = USE_CASES[useCaseIdx] ?? USE_CASES[0]!;
  const fallbackLook = activeUseCase.looks[useCaseLook % activeUseCase.looks.length] ?? activeUseCase.looks[0]!;
  let displayPieces: UseCasePiece[] = fallbackLook;
  let usingOwnWardrobe = false;
  if (items.length >= 3) {
    const bySlot = (slots: string[]) => items.filter((i) => slots.includes(i.slot));
    const pick = (arr: Item[], offset: number) => (arr.length ? arr[Math.abs(offset) % arr.length]! : null);
    const t = pick(bySlot(["top", "ethnic", "outerwear"]), useCaseLook + useCaseIdx);
    const b = pick(bySlot(["bottom"]), useCaseLook + 1);
    const s = pick(bySlot(["shoes"]), useCaseLook);
    if (t && b && s) {
      usingOwnWardrobe = true;
      displayPieces = [
        { slot: SLOT_LABEL[t.slot] ?? "Top", name: t.name, brand: t.brand || t.category, color: t.color, colorHex: t.colorHex },
        { slot: "Bottom", name: b.name, brand: b.brand || b.category, color: b.color, colorHex: b.colorHex },
        { slot: "Shoes", name: s.name, brand: s.brand || s.category, color: s.color, colorHex: s.colorHex },
      ];
    }
  }
  const useCaseMatch = Math.min(98, activeUseCase.baseMatch + (useCaseLook % 2 === 1 ? -2 : 0) + (usingOwnWardrobe ? 2 : 0));
  const useCaseSaved = savedUseCases.has(activeUseCase.label);
  const selectUseCase = (i: number) => { setUseCaseIdx(i); setUseCaseLook(0); };

  const onHeroMove = (e: React.MouseEvent) => {
    const r = heroRef.current?.getBoundingClientRect();
    if (!r) return;
    setTilt({ x: ((e.clientX - r.left) / r.width - 0.5) * 2, y: ((e.clientY - r.top) / r.height - 0.5) * 2 });
  };

  const steps = [
    { n: "01", t: "Upload", d: "Add clothes by uploading photos — one tap per piece, or a whole haul at once.", tags: ["Photo upload", "Bulk add", "Screenshot import"] },
    { n: "02", t: "Understand", d: "Vision AI reads every piece the way a stylist would.", tags: ["Category", "Colour", "Pattern", "Material", "Style", "Season", "Formality"] },
    { n: "03", t: "Style", d: "WearWise creates outfit combinations tuned to your day.", tags: ["Occasion", "Weather", "Personal style", "Compatibility"] },
    { n: "04", t: "Decide", d: "Before you buy something new, WearWise checks whether it actually adds value to your wardrobe.", tags: ["Buy or Skip", "Duplication check", "Projected cost-per-wear"] },
  ];

  return (
    <div>
      {/* ---------- HERO ---------- */}
      <section ref={heroRef} onMouseMove={onHeroMove} className="relative overflow-hidden" aria-label="WearWise introduction">
        <div className="pointer-events-none absolute inset-0" aria-hidden="true" style={{
          background: `radial-gradient(600px 340px at ${50 + tilt.x * 8}% ${18 + tilt.y * 5}%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 70%), radial-gradient(500px 300px at 85% 80%, rgba(157,179,138,.08), transparent 70%)`,
          transition: "background .3s",
        }} />
        <div className="relative mx-auto grid max-w-6xl gap-12 px-5 pt-14 pb-16 md:grid-cols-2 md:items-center md:pt-20 md:pb-24">
          <div className="anim-fade-up">
            <span className="inline-flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-[11px] font-bold tracking-[0.2em] uppercase" style={{ borderColor: "var(--glass-border)", background: "var(--glass)", color: "var(--accent)" }}>
              <span className="h-1.5 w-1.5 rounded-full" style={{ background: "var(--sage)", animation: "tickerPulse 2s infinite" }} />
              AI Wardrobe Intelligence
            </span>
            <h1 className="font-display mt-6 text-[52px] leading-[0.98] font-medium md:text-[76px]" style={{ color: "var(--text)" }}>
              Your Wardrobe.<br /><em className="font-medium" style={{ color: "var(--accent)" }}>Powered by Intelligence.</em>
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed" style={{ color: "var(--dim)" }}>
              WearWise understands what you own, helps you decide what to wear, and tells you what is actually worth buying.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <button type="button" onClick={openAuth} className="btn-lift rounded-full px-7 py-3.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Build My Wardrobe</button>
              <a href="#how" className="btn-lift inline-flex items-center rounded-full border px-7 py-3.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>See How It Works</a>
            </div>
            <p className="mt-8 text-sm" style={{ color: "var(--faint)" }}>Know what you own · Know what to wear · Know what to buy</p>
          </div>

          {/* Floating wardrobe stack */}
          <div className="relative mx-auto w-full max-w-md" style={{ perspective: "1100px" }}>
            <div className="overflow-hidden rounded-3xl border shadow-2xl" style={{ borderColor: "var(--border)", transform: `rotateY(${tilt.x * -4}deg) rotateX(${tilt.y * 3}deg)`, transition: "transform .35s cubic-bezier(.22,.8,.32,1)" }}>
              <img src={heroImg} alt="A curated wardrobe rail with navy, cream and olive pieces and white sneakers under warm light" className="aspect-[4/5] w-full object-cover md:aspect-[5/5]" />
            </div>
            <div className="floaty absolute -left-3 top-8 w-40 rounded-2xl border p-3 shadow-xl sm:-left-8" style={{ background: "var(--glass)", borderColor: "var(--glass-border)", backdropFilter: "blur(14px)", transform: `translate(${tilt.x * 8}px, ${tilt.y * 6}px)` }}>
              <p className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>Tonight</p>
              <p className="mt-1 text-sm font-semibold leading-snug" style={{ color: "var(--text)" }}>You have 3 great outfits for tonight.</p>
            </div>
            <div className="absolute -right-2 bottom-10 w-52 rounded-2xl border p-3.5 shadow-xl sm:-right-6" style={{ background: "var(--surface)", borderColor: "var(--border)", transform: `translate(${tilt.x * -10}px, ${tilt.y * -8}px)`, transition: "transform .35s" }}>
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)" }}>AI Pick · Date Night</p>
                <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>94%</span>
              </div>
              <div className="mt-2.5 flex gap-2">
                {(heroItems.length ? heroItems : []).map((it) => (
                  <div key={it.id} className="h-16 w-12 overflow-hidden rounded-lg"><ItemVisual item={it} /></div>
                ))}
                {heroItems.length === 0 ? <p className="text-xs" style={{ color: "var(--dim)" }}>Tommy Hilfiger shirt · Being Human chinos · Pepe Jeans sneakers</p> : null}
              </div>
              <p className="mt-2 text-xs leading-snug" style={{ color: "var(--dim)" }}>Tommy Hilfiger Oxford, Being Human chinos, Pepe Jeans sneakers — sharp, never overdressed.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- USE CASES — interactive occasion explorer ---------- */}
      <section className="border-y" style={{ borderColor: "var(--border)", background: "var(--bg-2)" }} aria-label="Use cases">
        <div className="mx-auto max-w-6xl px-5 py-12 md:py-16">
          <h2 className="reveal font-display text-center text-3xl font-medium md:text-4xl" style={{ color: "var(--text)" }}>Built for the way you actually dress.</h2>
          <p className="reveal mx-auto mt-3 max-w-xl text-center text-sm leading-relaxed md:text-base" style={{ color: "var(--dim)" }}>
            Tap an occasion — WearWise shows you a look for it, straight from {usingOwnWardrobe ? "your wardrobe" : "a real branded wardrobe"}. Shuffle it, save it, or style it live.
          </p>

          <div className="mt-8 flex flex-wrap justify-center gap-2.5" role="tablist" aria-label="Choose an occasion">
            {USE_CASES.map((uc, i) => {
              const active = useCaseIdx === i;
              return (
                <button key={uc.label} type="button" role="tab" id={`usecase-tab-${uc.label}`} aria-selected={active} aria-controls="usecase-panel"
                  onClick={() => selectUseCase(i)} onMouseEnter={() => { if (useCaseIdx !== i) selectUseCase(i); }}
                  onFocus={() => { if (useCaseIdx !== i) selectUseCase(i); }}
                  className="btn-lift inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-semibold"
                  style={active
                    ? { borderColor: "var(--accent)", background: "var(--accent)", color: "var(--accent-ink)", boxShadow: "0 10px 28px -12px color-mix(in srgb, var(--accent) 70%, transparent)" }
                    : { borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>
                  <span aria-hidden="true">{uc.icon}</span> {uc.label}
                  {savedUseCases.has(uc.label) ? <span aria-hidden="true" className="text-[11px]">★</span> : null}
                </button>
              );
            })}
          </div>

          <div key={`${activeUseCase.label}-${useCaseLook}`} id="usecase-panel" role="tabpanel" aria-labelledby={`usecase-tab-${activeUseCase.label}`}
            className="anim-pop mx-auto mt-8 max-w-4xl overflow-hidden rounded-3xl border text-left" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="grid md:grid-cols-[1.15fr_1fr]">
              <div className="p-6 md:p-7">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold tracking-[0.14em] uppercase" style={{ background: "color-mix(in srgb, var(--accent) 16%, transparent)", color: "var(--accent)" }}>
                    <span aria-hidden="true">{activeUseCase.icon}</span> {activeUseCase.label}
                  </span>
                  <span className="rounded-full px-3 py-1 text-[11px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{useCaseMatch}% Match</span>
                  {usingOwnWardrobe ? <span className="rounded-full border px-3 py-1 text-[11px] font-bold" style={{ borderColor: "var(--border)", color: "var(--sage)" }}>✦ From your wardrobe</span> : null}
                </div>
                <h3 className="font-display mt-4 text-[26px] leading-[1.15] font-medium md:text-3xl" style={{ color: "var(--text)" }}>{activeUseCase.headline}</h3>
                <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{activeUseCase.vibe}</p>

                <div className="mt-5">
                  <div className="mb-1.5 flex items-center justify-between text-xs">
                    <span className="font-bold tracking-[0.14em] uppercase" style={{ color: "var(--dim)" }}>Formality</span>
                    <span className="font-semibold" style={{ color: "var(--text)" }}>{["", "Relaxed", "Smart casual", "Smart casual", "Polished", "Formal"][activeUseCase.formality] ?? "Smart casual"} · {activeUseCase.formality}/5</span>
                  </div>
                  <Bar pct={activeUseCase.formality * 20} />
                </div>

                <div className="mt-5 flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold tracking-[0.14em] uppercase" style={{ color: "var(--dim)" }}>Palette</span>
                  {activeUseCase.palette.map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                      <span className="h-3.5 w-3.5 rounded-full border" style={{ background: c.hex, borderColor: "var(--border)" }} aria-hidden="true" />{c.name}
                    </span>
                  ))}
                </div>

                <p className="mt-5 rounded-2xl border px-4 py-3 text-sm leading-relaxed" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}>
                  <span className="font-bold" style={{ color: "var(--accent)" }}>Stylist tip — </span>{activeUseCase.tip}
                </p>

                <div className="mt-6 flex flex-wrap gap-2">
                  <button type="button" onClick={() => go("stylist")} className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                    Style me for {activeUseCase.label} →
                  </button>
                  <button type="button" onClick={() => setUseCaseLook((n) => n + 1)} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }} aria-label={`Show another ${activeUseCase.label} look`}>
                    ↻ Try another look
                  </button>
                  <button type="button" aria-pressed={useCaseSaved}
                    onClick={() => setSavedUseCases((prev) => { const n = new Set(prev); if (n.has(activeUseCase.label)) n.delete(activeUseCase.label); else n.add(activeUseCase.label); return n; })}
                    className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: useCaseSaved ? "var(--accent)" : "var(--border)", color: useCaseSaved ? "var(--accent)" : "var(--text)" }}>
                    {useCaseSaved ? "★ Saved look" : "☆ Save look"}
                  </button>
                </div>
                <p className="mt-3 min-h-5 text-xs" style={{ color: "var(--sage)" }} role="status" aria-live="polite">
                  {useCaseSaved ? `Saved — WearWise will prioritise ${activeUseCase.label} looks like this in your stylist.` : ""}
                </p>
              </div>

              <div className="border-t p-6 md:border-t-0 md:border-l md:p-7" style={{ borderColor: "var(--border)", background: "var(--bg-2)" }}>
                <p className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)" }}>
                  {usingOwnWardrobe ? "Your look — shuffle for more combinations" : `The look · Look ${useCaseLook % activeUseCase.looks.length + 1} of ${activeUseCase.looks.length}`}
                </p>
                <div className="mt-4 grid grid-cols-3 gap-3">
                  {displayPieces.map((p, idx) => (
                    <div key={`${p.slot}-${p.name}-${idx}`} className="anim-pop" style={{ animationDelay: `${idx * 110}ms` }}>
                      <div className="flex aspect-[3/4] flex-col items-center justify-center gap-1 overflow-hidden rounded-xl border px-2 text-center" style={{ borderColor: "var(--border)", background: `linear-gradient(150deg, ${p.colorHex}, ${p.colorHex}cc 55%, #00000055)` }} aria-hidden="true">
                        <span className="font-display text-3xl italic leading-none" style={{ color: "rgba(255,255,255,.92)", textShadow: "0 2px 12px rgba(0,0,0,.4)" }}>{(p.brand || p.name).charAt(0)}</span>
                        <span className="text-[9px] font-bold tracking-[0.16em] uppercase" style={{ color: "rgba(255,255,255,.85)" }}>{p.brand}</span>
                        <span className="text-[8px] font-semibold tracking-[0.12em] uppercase" style={{ color: "rgba(255,255,255,.65)" }}>{p.color}</span>
                      </div>
                      <p className="mt-2 text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--accent)" }}>{p.slot}</p>
                      <p className="text-xs font-semibold leading-tight" style={{ color: "var(--text)" }}>{p.brand} {p.name}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex items-center gap-4">
                  <ScoreRing score={useCaseMatch} size={76} label="Match" />
                  <p className="text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
                    Colour harmony, occasion fit and formality all line up for {activeUseCase.label.toLowerCase()}. {usingOwnWardrobe ? "Built from pieces you already own." : "Log in and this look is rebuilt from your own wardrobe."}
                  </p>
                </div>
                <div className="mt-4 flex gap-1.5" role="group" aria-label="Look selector">
                  {activeUseCase.looks.map((_, li) => (
                    <button key={li} type="button" onClick={() => setUseCaseLook(li)} aria-pressed={useCaseLook % activeUseCase.looks.length === li} aria-label={`Show look ${li + 1} for ${activeUseCase.label}`}
                      className="h-2 flex-1 rounded-full" style={{ background: useCaseLook % activeUseCase.looks.length === li ? "var(--accent)" : "var(--border)" }} />
                  ))}
                </div>
              </div>
            </div>
          </div>

          <p className="reveal mt-5 text-center text-xs" style={{ color: "var(--faint)" }}>
            {savedUseCases.size > 0 ? `${savedUseCases.size} occasion${savedUseCases.size > 1 ? "s" : ""} saved in this preview — ` : ""}Every occasion above opens in the AI Stylist with one tap.
          </p>
        </div>
      </section>


      {/* ---------- BRANDS ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-16" aria-label="Real brands in WearWise">
        <SectionHead kicker="Real Brands · Real Clothes" title={<>Not made-up clothes.<br />The brands you actually buy.</>} sub="WearWise now runs on real products, not made-up ones: a directory of 60 brands that exist and sell in India, a starting wardrobe of 24 real branded pieces, and 18 real products in Smart Shop — Nike, Levi’s, H&M, Allen Solly, Manyavar, FabIndia and more, at real ₹ prices with links to the real product pages." />
        <div className="mt-10 flex flex-wrap justify-center gap-2">
          {["Nike", "Adidas", "PUMA", "Levi’s", "H&M", "Zara", "Uniqlo", "Tommy Hilfiger", "Allen Solly", "Van Heusen", "Louis Philippe", "Peter England", "Manyavar", "FabIndia", "Jack & Jones", "U.S. Polo Assn.", "Marks & Spencer", "Woodland", "Roadster", "Spykar"].map((b) => (
            <button key={b} type="button" onClick={() => go("brands")} className="btn-lift rounded-full border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text)" }}>{b}</button>
          ))}
        </div>
        <div className="mt-8 text-center">
          <button type="button" onClick={() => go("brands")} className="btn-lift rounded-full px-7 py-3.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Browse All 60 Brands A–Z</button>
        </div>
      </section>

      {/* ---------- STORY ---------- */}
      <section className="mx-auto max-w-3xl px-5 py-20 text-center" aria-label="The problem WearWise solves">
        <p className="reveal font-display text-4xl leading-[1.12] font-medium md:text-5xl" style={{ color: "var(--text)" }}>
          Your wardrobe is full.<br />But somehow, you still don’t know <em style={{ color: "var(--accent)" }}>what to wear.</em>
        </p>
        <p className="reveal mx-auto mt-6 max-w-xl text-base leading-relaxed" style={{ color: "var(--dim)" }}>
          WearWise turns your wardrobe into an intelligent personal stylist. It understands what you own, learns what you like, and helps you decide what to wear — and what to buy.
        </p>
        <div className="reveal mt-8 flex flex-wrap justify-center gap-2 text-xs font-bold tracking-[0.14em] uppercase" style={{ color: "var(--faint)" }}>
          <span>Understands</span><span aria-hidden="true">→</span><span>Learns</span><span aria-hidden="true">→</span><span>Styles</span><span aria-hidden="true">→</span><span style={{ color: "var(--accent)" }}>Decides</span>
        </div>
      </section>

      {/* ---------- CLOSET VIZ (product preview) ---------- */}
      <section className="mx-auto max-w-6xl px-5 pb-20" aria-label="Wardrobe intelligence preview">
        <SectionHead kicker="Wardrobe Intelligence" title={<>Your closet is more intelligent<br />than you think.</>} sub="A preview of the intelligence WearWise builds from a real wardrobe. Log in and this becomes your closet, counted live." />
        <div className="reveal mt-12 grid gap-8 md:grid-cols-[1fr_1.2fr] md:items-center">
          <div className="text-center md:text-left">
            <p className="font-display text-[88px] leading-none font-medium" style={{ color: "var(--text)" }}>87</p>
            <p className="mt-1 text-sm font-bold tracking-[0.2em] uppercase" style={{ color: "var(--dim)" }}>Items, understood</p>
            <div className="mt-8 grid gap-3 text-left">
              <div className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                <p className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>{closetActive.label} · {closetActive.count} items</p>
                <p className="mt-2 text-sm" style={{ color: "var(--text)" }}>Most worn: <strong>{closetActive.most}</strong></p>
                <p className="text-sm" style={{ color: "var(--dim)" }}>Forgotten: {closetActive.least} · Dominant colour: {closetActive.color}</p>
              </div>
            </div>
          </div>
          <div className="grid gap-2" role="tablist" aria-label="Wardrobe categories">
            {CLOSET_PREVIEW.map((c, i) => (
              <button key={c.label} type="button" role="tab" aria-selected={closet === i} onMouseEnter={() => setCloset(i)} onClick={() => setCloset(i)}
                className="btn-lift flex items-center justify-between rounded-xl border px-5 py-3.5 text-left"
                style={closet === i
                  ? { borderColor: "var(--accent)", background: "var(--surface-2)", color: "var(--text)" }
                  : { borderColor: "var(--border)", background: "var(--surface)", color: "var(--dim)" }}>
                <span className="font-semibold">{c.label}</span>
                <span className="flex items-center gap-3">
                  <span className="hidden h-1.5 w-24 overflow-hidden rounded-full sm:block" style={{ background: "var(--border)" }}>
                    <span className="block h-full rounded-full" style={{ width: `${(c.count / 20) * 100}%`, background: "var(--accent)", transition: "width .6s" }} />
                  </span>
                  <span className="font-display text-2xl" style={{ color: "var(--text)" }}>{c.count}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* ---------- HOW IT WORKS ---------- */}
      <section id="how" className="border-y" style={{ borderColor: "var(--border)", background: "var(--bg-2)" }} aria-label="How WearWise works">
        <div className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead kicker="How It Works" title="Four steps between a full closet and a decided morning." />
          <div className="reveal mt-12 grid gap-3 md:grid-cols-4" role="tablist" aria-label="How it works steps">
            {steps.map((s, i) => (
              <button key={s.n} type="button" role="tab" aria-selected={step === i} onClick={() => setStep(i)} onMouseEnter={() => setStep(i)}
                className="btn-lift rounded-2xl border p-6 text-left"
                style={step === i
                  ? { borderColor: "var(--accent)", background: "var(--surface)" }
                  : { borderColor: "var(--border)", background: "transparent" }}>
                <p className="font-display text-4xl" style={{ color: step === i ? "var(--accent)" : "var(--faint)" }}>{s.n}</p>
                <h3 className="mt-3 text-lg font-bold" style={{ color: "var(--text)" }}>{s.t}</h3>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{s.d}</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {s.tags.map((t) => <span key={t} className="rounded-full px-2.5 py-1 text-[11px] font-semibold" style={{ background: "var(--glass)", color: "var(--dim)", border: "1px solid var(--glass-border)" }}>{t}</span>)}
                </div>
              </button>
            ))}
          </div>
          <div className="mt-10 text-center">
            <button type="button" onClick={() => go("stylist")} className="btn-lift rounded-full px-7 py-3.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Try the AI Stylist</button>
          </div>
        </div>
      </section>

      {/* ---------- PERSONALISATION LOOP ---------- */}
      <section className="mx-auto max-w-6xl px-5 py-20" aria-label="How WearWise learns your style">
        <div className="grid items-center gap-10 md:grid-cols-2">
          <div className="reveal">
            <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Personalisation</p>
            <h2 className="font-display mt-3 text-4xl leading-[1.05] font-medium md:text-5xl" style={{ color: "var(--text)" }}>It doesn’t just know your clothes. It learns <em style={{ color: "var(--accent)" }}>you.</em></h2>
            <p className="mt-5 max-w-md leading-relaxed" style={{ color: "var(--dim)" }}>Every outfit you wear, save, or skip teaches WearWise. “You keep choosing relaxed fits and neutral colours” becomes a preference it styles around — automatically.</p>
            <div className="mt-6 inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--sage)" }}>✦ WearWise learned your preference</div>
          </div>
          <ol className="reveal grid gap-2.5">
            {["Your Wardrobe", "Your Choices", "Your Feedback", "AI Learns Your Style", "Better Recommendations"].map((s, i, arr) => (
              <li key={s}>
                <div className="flex items-center gap-4 rounded-2xl border px-5 py-4" style={{ borderColor: i === arr.length - 1 ? "var(--accent)" : "var(--border)", background: "var(--surface)" }}>
                  <span className="font-display text-2xl" style={{ color: i === arr.length - 1 ? "var(--accent)" : "var(--faint)" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span className="font-semibold" style={{ color: "var(--text)" }}>{s}</span>
                </div>
                {i < arr.length - 1 ? <div className="py-0.5 pl-9 text-lg" style={{ color: "var(--accent)" }} aria-hidden="true">↓</div> : null}
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ---------- FINAL CTA ---------- */}
      <section className="relative overflow-hidden border-t" style={{ borderColor: "var(--border)" }} aria-label="Get started">
        <img src={heroImg} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-25" />
        <div className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--bg) 8%, transparent)" }} aria-hidden="true" />
        <div className="relative mx-auto max-w-3xl px-5 py-24 text-center">
          <h2 className="reveal font-display text-4xl leading-[1.08] font-medium md:text-6xl" style={{ color: "var(--text)" }}>Your wardrobe already has more possibilities than you think.</h2>
          <p className="reveal font-display mt-4 text-2xl italic" style={{ color: "var(--accent)" }}>Let AI find them.</p>
          <button type="button" onClick={openAuth} className="btn-lift reveal mt-9 rounded-full px-8 py-4 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Start with WearWise</button>
          <p className="reveal mt-10 text-xs font-bold tracking-[0.24em] uppercase leading-loose" style={{ color: "var(--dim)" }}>Know what you own.<br />Know what to wear. Know what to buy.</p>
        </div>
      </section>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* App views                                                           */
/* ------------------------------------------------------------------ */

/* Shared data hooks — every screen reads the wardrobe through these.
   The query keys match WearWiseProvider's core queries, so React Query
   serves all screens (and the global store's hydration) from ONE fetch
   of ONE wardrobe: add a piece anywhere and it appears everywhere. */
function useItems(userId: number | null) {
  return useQuery({ queryKey: ["items", userId], queryFn: () => api.listItems({ userId: userId! }), enabled: userId !== null });
}
function useInsights(userId: number | null) {
  return useQuery({ queryKey: ["insights", userId], queryFn: () => api.getInsights({ userId: userId! }), enabled: userId !== null });
}

function Dashboard({ userId, name, go, toast }: { userId: number; name: string; go: (v: View) => void; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const items = useItems(userId);
  const insights = useInsights(userId);
  /* The same wardrobe, seen through the global store: selector-derived
     analytics must agree with the server insight counts because both
     are computed from these identical rows (one source of truth). */
  const shared = useWearWiseOptional();
  const sharedAnalytics = shared?.analytics;
  const [seed, setSeed] = useState(0);
  const [occasion, setOccasion] = useState("College");
  const outfitQ = useQuery({
    queryKey: ["outfit", userId, occasion, "Warm", "Smart Casual", seed],
    queryFn: () => api.generateOutfit({ userId, occasion, weather: "Warm", style: "Smart Casual", seed }),
    enabled: (items.data?.items.length ?? 0) > 0,
  });
  const wear = useMutation({
    mutationFn: (ids: number[]) => wardrobeService.markWorn(userId, ids),
    onSuccess: (_d, ids) => {
      shared?.dispatch(storeActions.markOutfitWorn(null, ids));
      qc.invalidateQueries(); toast("Marked as worn — WearWise is learning ✦");
    },
  });
  const upgrade = useMutation({
    mutationFn: () => api.seedRealWardrobe({ userId }),
    onSuccess: (d) => { qc.invalidateQueries(); toast(`Loaded ${d.count} real branded pieces ✦`); },
  });
  const dashItems = items.data?.items ?? [];
  const needsUpgrade = dashItems.length > 0 && !dashItems.some((i) => i.brand);
  const save = useMutation({
    mutationFn: (o: Outfit) => api.saveOutfit({ userId, title: o.title, itemIds: o.items.map((i) => i.id), occasion, matchScore: o.matchScore, explanation: o.explanation }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saved", userId] }); toast("Saved to your wardrobe ✦"); },
  });
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const outfit = outfitQ.data?.outfit;
  const ins = insights.data;
  const [weatherSeed, setWeatherSeed] = useState(0);
  const weatherQ = useQuery({
    queryKey: ["weather", userId, weatherSeed],
    queryFn: () => api.getWeatherOutfit({ userId, seed: weatherSeed }),
    enabled: dashItems.length > 0,
  });

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Today</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>{greeting}, {name.split(" ")[0]}.</h1>
      <p className="mt-2 text-lg" style={{ color: "var(--dim)" }}>What are you wearing today?</p>

      {needsUpgrade ? (
        <div className="mt-6 rounded-3xl border p-5" style={{ borderColor: "var(--accent)", background: "var(--surface)" }} role="region" aria-label="Real brands available">
          <p className="font-display text-2xl" style={{ color: "var(--text)" }}>Real brands are here.</p>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Your wardrobe is still the old made-up demo set. Replace it with 24 real products from Nike, Levi's, H&M, Allen Solly, Manyavar, Tommy Hilfiger and more — real ₹ prices, real product pages.</p>
          <button type="button" disabled={upgrade.isPending} onClick={() => upgrade.mutate()} className="btn-lift mt-4 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            {upgrade.isPending ? "Loading real brands…" : "Switch to Real Branded Wardrobe"}
          </button>
        </div>
      ) : null}

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Quick occasion">
        {["College", "Casual", "Interview", "Party", "Travel"].map((o) => (
          <button key={o} type="button" onClick={() => { setOccasion(o); setSeed(0); }} aria-pressed={occasion === o}
            className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold"
            style={occasion === o ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
            {o}
          </button>
        ))}
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Today's AI suggestion">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-2xl font-medium" style={{ color: "var(--text)" }}>Today’s Pick</h2>
            {outfit ? <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{outfit.matchScore}% Match</span> : null}
          </div>
          {items.isPending || outfitQ.isPending ? <p className="mt-6 text-sm" style={{ color: "var(--dim)" }}>Styling your wardrobe…</p>
            : outfit && outfit.items.length ? (
              <>
                <div className="mt-5"><OutfitStrip outfit={outfit} /></div>
                <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{outfit.explanation}</p>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="button" disabled={wear.isPending} onClick={() => wear.mutate(outfit.items.map((i) => i.id))} className="btn-lift rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Wear This</button>
                  <button type="button" onClick={() => setSeed((s) => s + 1)} className="btn-lift rounded-full border px-6 py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Try Another</button>
                  <button type="button" disabled={save.isPending} onClick={() => save.mutate(outfit)} className="btn-lift rounded-full border px-6 py-3 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Save Outfit</button>
                </div>
              </>
            ) : (
              <div className="mt-6">
                <p className="text-sm" style={{ color: "var(--dim)" }}>Your wardrobe is empty — add your first pieces and the AI stylist gets to work.</p>
                <button type="button" onClick={() => go("add")} className="btn-lift mt-4 rounded-full px-6 py-3 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Add Clothing</button>
              </div>
            )}
        </section>

        <div className="grid gap-6">
          <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Wardrobe summary">
            <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Wardrobe Summary</h2>
            {ins ? (
              <div className="mt-4 grid grid-cols-2 gap-4">
                {[[`${ins.totalItems}`, "Items"], [`${ins.totalOutfits}`, "Outfits possible"], [`${ins.favorites}`, "Favourites"], [`${ins.unused}`, "Rarely worn"]].map(([n, l]) => (
                  <div key={l}>
                    <p className="font-display text-4xl font-medium" style={{ color: "var(--text)" }}>{n}</p>
                    <p className="text-xs" style={{ color: "var(--dim)" }}>{l}</p>
                  </div>
                ))}
              </div>
            ) : <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>Counting your closet…</p>}
            {sharedAnalytics && ins && sharedAnalytics.totalItems === ins.totalItems ? (
              <p className="mt-3 text-[11px]" style={{ color: "var(--faint)" }}>
                Shared wardrobe state · {sharedAnalytics.totalItems} items · {sharedAnalytics.favoriteItems} favourites · health {sharedAnalytics.wardrobeHealthScore}/100 · synced across Stylist, Shop &amp; Analytics
              </p>
            ) : null}
            <button type="button" onClick={() => go("wardrobe")} className="btn-lift mt-5 text-sm font-bold" style={{ color: "var(--accent)" }}>Open my wardrobe →</button>
          </section>
          <section className="rounded-3xl border p-6" style={{ background: "linear-gradient(140deg, var(--surface), var(--surface-2))", borderColor: "var(--border)" }} aria-label="AI insight">
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>✦ AI Insight</p>
            <p className="font-display mt-3 text-xl leading-snug italic" style={{ color: "var(--text)" }}>
              {ins ? `“${ins.insight}”` : "Reading your wardrobe…"}
            </p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => go("buy")} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Should I buy this?</button>
              <button type="button" onClick={() => go("shop")} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Smart Shop</button>
            </div>
          </section>
        </div>
      </div>

      {/* Weather stylist + insight feed */}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="rounded-3xl border p-6" style={{ background: "linear-gradient(150deg, var(--surface), var(--surface-2))", borderColor: "var(--border)" }} aria-label="Weather stylist">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>☀ Weather Stylist</p>
              {weatherQ.data ? (
                <>
                  <p className="font-display mt-2 text-5xl font-medium" style={{ color: "var(--text)" }}>{weatherQ.data.weather.temp}°C</p>
                  <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>{weatherQ.data.weather.condition} · Feels like {weatherQ.data.weather.feelsLike}°C · Humidity {weatherQ.data.weather.humidity}% · Rain chance {weatherQ.data.weather.rainChance}%</p>
                </>
              ) : <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>Reading today's sky…</p>}
            </div>
            <button type="button" onClick={() => setWeatherSeed((s) => s + 1)} className="btn-lift shrink-0 rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Generate Another</button>
          </div>
          {weatherQ.data ? (
            <>
              <p className="font-display mt-4 text-lg italic leading-snug" style={{ color: "var(--text)" }}>“{weatherQ.data.weather.advice}”</p>
              <div className="mt-4"><OutfitStrip outfit={weatherQ.data.outfit} compact /></div>
            </>
          ) : null}
        </section>
        <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="AI insight feed">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>✦ AI Insight Feed</h2>
            <button type="button" onClick={() => go("analytics")} className="btn-lift text-xs font-bold" style={{ color: "var(--accent)" }}>Full analytics →</button>
          </div>
          <ul className="mt-4 grid gap-2.5">
            {(ins?.feed ?? []).map((f) => (
              <li key={f} className="flex items-start gap-2.5 rounded-2xl border px-4 py-3 text-sm leading-relaxed" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}>
                <span aria-hidden="true" style={{ color: "var(--accent)" }}>✦</span>{f}
              </li>
            ))}
            {!ins ? <li className="text-sm" style={{ color: "var(--dim)" }}>Reading your wardrobe…</li> : null}
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => go("snap")} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>📸 Snap &amp; Style</button>
            <button type="button" onClick={() => go("pack")} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>🧳 Pack Smart</button>
            <button type="button" onClick={() => go("analytics")} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Use this again →</button>
          </div>
        </section>
      </div>

      <AnalyticsSection userId={userId} />
    </div>
  );
}

function AnalyticsSection({ userId }: { userId: number }) {
  const insights = useInsights(userId);
  const items = useItems(userId);
  const ins = insights.data;
  const health = useCounter(ins?.health ?? 0, Boolean(ins));
  if (!ins) return <p className="mt-10 text-sm" style={{ color: "var(--dim)" }}>Building your wardrobe intelligence…</p>;
  const byCpw = [...(items.data?.items ?? [])].sort((a, b) => a.costPerWear - b.costPerWear);
  const best = ins.bestValue ?? byCpw[0];
  const worst = ins.worstValue ?? byCpw[byCpw.length - 1];
  return (
    <section className="mt-12" aria-label="Wardrobe intelligence">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="font-display text-3xl font-medium" style={{ color: "var(--text)" }}>Wardrobe Intelligence</h2>
        <p className="text-sm" style={{ color: "var(--dim)" }}>Computed live from everything you own and wear.</p>
      </div>
      <div className="mt-6 grid gap-6 md:grid-cols-3">
        <div className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="flex justify-center"><ScoreRing score={health} size={132} label="Health" /></div>
          <p className="mt-3 text-center text-sm font-semibold" style={{ color: "var(--text)" }}>Wardrobe Health · {ins.health} / 100</p>
          <div className="mt-5 grid gap-3">
            {ins.dimensions.map((d) => (
              <div key={d.label}>
                <div className="mb-1 flex items-center justify-between text-xs"><span style={{ color: "var(--dim)" }}>{d.label}</span><span className="font-bold" style={{ color: "var(--text)" }}>{d.score}</span></div>
                <Bar pct={d.score} />
              </div>
            ))}
          </div>
          <p className="mt-5 rounded-2xl border px-4 py-3 text-xs leading-relaxed" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}>
            <span className="font-bold" style={{ color: "var(--accent)" }}>Your biggest opportunity — </span>{ins.opportunity}
          </p>
        </div>
        <div className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>How your wardrobe is used</h3>
          <div className="mt-5 grid gap-4">
            {([["Frequently used", ins.usage.frequent, "var(--sage)"], ["Occasionally used", ins.usage.occasional, "var(--accent)"], ["Rarely used", ins.usage.rare, "var(--danger)"]] as const).map(([l, pct, col]) => (
              <div key={l}>
                <div className="mb-1.5 flex justify-between text-sm"><span style={{ color: "var(--text)" }}>{l}</span><span className="font-bold" style={{ color: "var(--text)" }}>{pct}%</span></div>
                <Bar pct={pct} color={col} />
              </div>
            ))}
          </div>
          <h3 className="mt-6 text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Your wardrobe is missing</h3>
          <ul className="mt-3 grid gap-1.5">
            {ins.missing.map((m) => <li key={m} className="text-sm" style={{ color: "var(--text)" }}>— {m}</li>)}
          </ul>
        </div>
        <div className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <h3 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Cost per wear</h3>
          {best ? (
            <div className="mt-4">
              <p className="font-semibold" style={{ color: "var(--text)" }}>{best.name}</p>
              <p className="mt-1"><PriceBlock price={best.price} mrp={best.mrp} /></p>
              <p className="text-xs" style={{ color: "var(--dim)" }}>Price paid in ₹ · worn {best.wornCount} times</p>
              <p className="font-display mt-1 text-3xl" style={{ color: "var(--sage)" }}>{inr(best.costPerWear)} <span className="text-base">/ wear</span></p>
            </div>
          ) : null}
          {worst && worst.id !== best?.id ? (
            <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
              <p className="font-semibold" style={{ color: "var(--text)" }}>{worst.name}</p>
              <p className="mt-1"><PriceBlock price={worst.price} mrp={worst.mrp} /></p>
              <p className="text-xs" style={{ color: "var(--dim)" }}>Price paid in ₹ · worn {worst.wornCount} times</p>
              <p className="font-display mt-1 text-3xl" style={{ color: "var(--danger)" }}>{inr(worst.costPerWear)} <span className="text-base">/ wear</span></p>
            </div>
          ) : null}
          {best ? <p className="mt-4 text-sm italic leading-relaxed" style={{ color: "var(--dim)" }}>“Your {best.name.toLowerCase()} are one of the best-value items in your wardrobe.”</p> : null}
        </div>
      </div>
    </section>
  );
}

/* ---------------- Wardrobe ---------------- */

const SLOT_FILTERS = [["all", "All"], ["top", "Tops"], ["bottom", "Bottoms"], ["shoes", "Shoes"], ["outerwear", "Outerwear"], ["accessory", "Accessories"], ["ethnic", "Ethnic"]] as const;

function Wardrobe({ userId, go, toast }: { userId: number; go: (v: View) => void; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const items = useItems(userId);
  const shared = useWearWiseOptional();
  const [slot, setSlot] = useState<string>("all");
  const [brand, setBrand] = useState("All brands");
  const [color, setColor] = useState("All colours");
  const [season, setSeason] = useState("All seasons");
  const [occasion, setOccasion] = useState("All occasions");
  const [sort, setSort] = useState("Newest");
  const [query, setQuery] = useState("");
  const [favOnly, setFavOnly] = useState(false);
  const [editing, setEditing] = useState<Item | null>(null);
  const [editName, setEditName] = useState("");
  const [editPrice, setEditPrice] = useState("");
  const [editMrp, setEditMrp] = useState("");
  const [editCategory, setEditCategory] = useState("Shirt");
  const [editColor, setEditColor] = useState("Black");
  const [editPattern, setEditPattern] = useState("Solid");
  const [editMaterial, setEditMaterial] = useState("Cotton");
  const [editStyle, setEditStyle] = useState("Casual");
  const [editFit, setEditFit] = useState("Regular");
  const [editOccasions, setEditOccasions] = useState<string[]>([]);
  const [editSeason, setEditSeason] = useState("All Season");
  /* Photo editing: a processed replacement waiting to save, or a
     removal flag. Neither touches the server until Save — Cancel
     leaves the saved photo exactly as it was. */
  const [editPhoto, setEditPhoto] = useState<UploadedPhoto | null>(null);
  const [editPhotoPreview, setEditPhotoPreview] = useState<string | null>(null);
  const [editPhotoRemoved, setEditPhotoRemoved] = useState(false);
  const [editPhotoError, setEditPhotoError] = useState<string | null>(null);
  const [updError, setUpdError] = useState<string | null>(null);
  const editFileRef = useRef<HTMLInputElement>(null);

  const all = items.data?.items ?? [];
  const brandOptions = useMemo(() => ["All brands", ...new Set(all.map((i) => i.brand).filter(Boolean))], [all]);
  const hasBranded = all.some((i) => i.brand);
  const colors = useMemo(() => ["All colours", ...new Set(all.map((i) => i.color))], [all]);
  const seasons = useMemo(() => ["All seasons", ...new Set(all.map((i) => i.season))], [all]);
  const occasionOptions = useMemo(() => ["All occasions", ...new Set(all.flatMap((i) => i.occasions))], [all]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    let list = all.filter((i) =>
      (slot === "all" || i.slot === slot) && (brand === "All brands" || i.brand === brand) && (color === "All colours" || i.color === color) && (season === "All seasons" || i.season === season)
      && (occasion === "All occasions" || i.occasions.includes(occasion))
      && (!favOnly || i.favorite)
      && (!q || `${i.name} ${i.brand} ${i.category} ${i.color} ${i.style} ${i.fit}`.toLowerCase().includes(q)));
    if (sort === "Most worn") list = [...list].sort((a, b) => b.wornCount - a.wornCount);
    if (sort === "Least worn") list = [...list].sort((a, b) => a.wornCount - b.wornCount);
    if (sort === "Best value") list = [...list].sort((a, b) => a.costPerWear - b.costPerWear);
    return list;
  }, [all, slot, brand, color, season, occasion, sort, query, favOnly]);

  const wear = useMutation({
    mutationFn: (i: Item) => wardrobeService.markWorn(userId, [i.id]),
    onSuccess: (_d, i) => { shared?.dispatch(storeActions.markItemWorn(i.id)); qc.invalidateQueries(); toast("Marked as worn today ✦"); },
  });
  const fav = useMutation({ mutationFn: (i: Item) => api.updateItem({ userId, itemId: i.id, favorite: !i.favorite }), onSuccess: () => qc.invalidateQueries({ queryKey: ["items", userId] }) });
  const del = useMutation({
    mutationFn: (i: Item) => wardrobeService.deleteItem(userId, i.id),
    onSuccess: (_d, i) => { shared?.dispatch(storeActions.deleteClothing(i.id)); qc.invalidateQueries(); toast("Removed from your wardrobe"); },
  });
  const upgrade = useMutation({
    mutationFn: () => api.seedRealWardrobe({ userId }),
    onSuccess: (d) => { qc.invalidateQueries(); toast(`Loaded ${d.count} real branded pieces ✦`); },
  });
  const upd = useMutation({
    mutationFn: () => api.updateItem({
      userId, itemId: editing!.id, name: editName.trim() || editing!.name, price: Number(editPrice) || 0,
      mrp: editMrp.trim() === "" ? null : Number(editMrp) || null,
      category: editCategory, slot: slotForCategory(editCategory, editing!.slot),
      color: editColor, colorHex: colorHexFor(editColor, editing!.colorHex),
      pattern: editPattern, material: editMaterial, style: editStyle, season: editSeason,
      fit: editFit, occasions: editOccasions,
      /* Photo tri-state: replacement object, null = remove, omitted = keep. */
      photo: editPhoto ?? (editPhotoRemoved ? null : undefined),
    }),
    onSuccess: () => { qc.invalidateQueries(); setEditing(null); toast("Wardrobe updated ✦"); },
    onError: (e) => setUpdError(e instanceof Error ? e.message : "Couldn’t save those changes — try again."),
  });

  const openEdit = (i: Item) => {
    setEditing(i);
    setEditName(i.name); setEditPrice(String(i.price)); setEditMrp(i.mrp ? String(i.mrp) : "");
    setEditCategory(i.category); setEditColor(i.color); setEditPattern(i.pattern);
    setEditMaterial(i.material); setEditStyle(i.style); setEditSeason(i.season);
    setEditFit(i.fit); setEditOccasions(i.occasions);
    setEditPhoto(null); setEditPhotoPreview(null); setEditPhotoRemoved(false);
    setEditPhotoError(null); setUpdError(null);
  };

  const handleEditPhotoFile = async (file: File) => {
    setEditPhotoError(null);
    try {
      const processed = await processPhotoFile(file);
      setEditPhoto(processed);
      setEditPhotoRemoved(false);
      setEditPhotoPreview(`data:${processed.mimeType};base64,${processed.dataBase64}`);
    } catch (e) {
      setEditPhotoError(e instanceof Error ? e.message : "That photo couldn't be used — try a different one.");
    }
  };

  const selectCls = "rounded-full border px-3 py-2 text-sm font-medium";
  const selectStyle = { background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" } as const;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>My Wardrobe</p>
          <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>{all.length} pieces, understood.</h1>
        </div>
        <button type="button" onClick={() => go("add")} className="btn-lift rounded-full px-6 py-3 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>+ Add Clothing</button>
      </div>

      {!items.isPending && all.length > 0 && !hasBranded ? (
        <div className="mt-7 rounded-3xl border p-5" style={{ borderColor: "var(--accent)", background: "var(--surface)" }} role="region" aria-label="Upgrade to real branded wardrobe">
          <p className="font-display text-2xl" style={{ color: "var(--text)" }}>This is still the old made-up demo wardrobe.</p>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Swap it for 24 real pieces from real brands — Nike, Levi's, H&M, Allen Solly, Manyavar and more — with real prices and links to the actual products on Ajio, Myntra, Nykaa and the brands' own stores.</p>
          <button type="button" disabled={upgrade.isPending} onClick={() => upgrade.mutate()} className="btn-lift mt-4 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            {upgrade.isPending ? "Loading real brands…" : "Load Real Branded Wardrobe"}
          </button>
        </div>
      ) : null}

      <div className="mt-7 flex gap-2 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Filter by category">
        {SLOT_FILTERS.map(([v, l]) => (
          <button key={v} type="button" onClick={() => setSlot(v)} aria-pressed={slot === v}
            className="btn-lift shrink-0 rounded-full border px-4 py-2 text-sm font-semibold"
            style={slot === v ? { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
            {l}
          </button>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="f-search">Search your wardrobe</label>
        <input id="f-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, brand, colour, fit…"
          className="min-w-48 flex-1 rounded-full border px-4 py-2 text-sm sm:flex-none sm:w-64" style={selectStyle} />
        <button type="button" onClick={() => setFavOnly((v) => !v)} aria-pressed={favOnly}
          className="btn-lift rounded-full border px-4 py-2 text-sm font-semibold"
          style={favOnly ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
          ★ Favourites only
        </button>
        <label className="sr-only" htmlFor="f-brand">Filter by brand</label>
        <select id="f-brand" value={brand} onChange={(e) => setBrand(e.target.value)} className={selectCls} style={selectStyle}>{brandOptions.map((b) => <option key={b}>{b}</option>)}</select>
        <label className="sr-only" htmlFor="f-color">Filter by colour</label>
        <select id="f-color" value={color} onChange={(e) => setColor(e.target.value)} className={selectCls} style={selectStyle}>{colors.map((c) => <option key={c}>{c}</option>)}</select>
        <label className="sr-only" htmlFor="f-season">Filter by season</label>
        <select id="f-season" value={season} onChange={(e) => setSeason(e.target.value)} className={selectCls} style={selectStyle}>{seasons.map((s) => <option key={s}>{s}</option>)}</select>
        <label className="sr-only" htmlFor="f-occasion">Filter by occasion</label>
        <select id="f-occasion" value={occasion} onChange={(e) => setOccasion(e.target.value)} className={selectCls} style={selectStyle}>{occasionOptions.map((o) => <option key={o}>{o}</option>)}</select>
        <label className="sr-only" htmlFor="f-sort">Sort wardrobe</label>
        <select id="f-sort" value={sort} onChange={(e) => setSort(e.target.value)} className={selectCls} style={selectStyle}>
          {["Newest", "Most worn", "Least worn", "Best value"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </div>

      {items.isPending ? <p className="mt-10 text-sm" style={{ color: "var(--dim)" }}>Opening your wardrobe…</p>
        : filtered.length === 0 ? (
          <div className="mt-10 rounded-3xl border border-dashed p-10 text-center" style={{ borderColor: "var(--border)" }}>
            <p className="font-display text-2xl" style={{ color: "var(--text)" }}>Nothing matches those filters.</p>
            <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>Try a different category — or add something new.</p>
          </div>
        ) : (
          <div className="mt-7 grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-4">
            {filtered.map((it) => (
              <ItemCard key={it.id} item={it} busy={wear.isPending}
                onWear={(i) => wear.mutate(i)} onToggleFav={(i) => fav.mutate(i)}
                onEdit={(i) => openEdit(i)}
                onDelete={(i) => del.mutate(i)}
                onFindOutfits={() => go("stylist")} />
            ))}
          </div>
        )}

      {editing ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label={`Edit ${editing.name}`}>
          <button type="button" aria-label="Close editor" className="absolute inset-0 h-full w-full cursor-default" style={{ background: "rgba(4,4,6,.7)" }} onClick={() => setEditing(null)} />
          <form className="anim-pop relative max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-3xl sm:rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}
            onSubmit={(e) => { e.preventDefault(); upd.mutate(); }}>
            <h2 className="font-display text-2xl" style={{ color: "var(--text)" }}>Edit piece</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Fix anything the scan got wrong — category, colour, style and season included.</p>
            <div className="mt-4">
              <p className="mb-1.5 text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>Photo</p>
              <div className="flex items-center gap-3">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  {editPhotoPreview ? <img src={editPhotoPreview} alt={editing.name} className="h-full w-full object-cover" />
                    : <ItemVisual item={editPhotoRemoved ? { ...editing, photoUrl: null } : editing} />}
                </div>
                <div className="flex flex-col items-start gap-1.5">
                  <button type="button" onClick={() => editFileRef.current?.click()} className="btn-lift rounded-full border px-3.5 py-1.5 text-xs font-bold" style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--surface-2)" }}>
                    {editing.photoUrl || editPhotoPreview ? "Replace photo" : "Add a photo"}
                  </button>
                  {(editing.photoUrl || editPhotoPreview) && !editPhotoRemoved ? (
                    <button type="button" onClick={() => { setEditPhoto(null); setEditPhotoPreview(null); setEditPhotoRemoved(true); }} className="btn-lift rounded-full border px-3.5 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--danger)", background: "var(--surface-2)" }}>Remove photo</button>
                  ) : null}
                  <p className="text-xs leading-relaxed" style={{ color: "var(--faint)" }}>
                    {editPhoto ? "New photo ready — it replaces the saved one when you save."
                      : editPhotoRemoved ? "The photo comes off when you save — the piece falls back to its colour tile."
                        : editing.photoUrl ? "This piece shows your saved photo."
                          : "No photo saved — this piece shows its colour tile."}
                  </p>
                </div>
              </div>
              <input ref={editFileRef} type="file" accept="image/*" className="hidden" aria-label="Upload a replacement photo"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleEditPhotoFile(f); e.target.value = ""; }} />
              {editPhotoError ? <p className="mt-2 text-xs font-semibold" style={{ color: "var(--danger)" }} role="alert">{editPhotoError}</p> : null}
            </div>
            <label htmlFor="edit-name" className="mt-4 mb-1.5 block text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>Name</label>
            <input id="edit-name" {...FIELDS.updateItem.name} value={editName} onChange={(e) => setEditName(e.target.value)} className="w-full rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
            <div className="mt-4 grid grid-cols-2 gap-3">
              <GarmentSelect id="edit-category" label="Category" value={editCategory} onChange={setEditCategory} options={CATEGORY_OPTIONS} />
              <GarmentSelect id="edit-color" label="Colour" value={editColor} onChange={setEditColor} options={COLOR_OPTIONS.map((c) => c.name)} />
              <GarmentSelect id="edit-pattern" label="Pattern" value={editPattern} onChange={setEditPattern} options={PATTERN_OPTIONS} />
              <GarmentSelect id="edit-material" label="Material" value={editMaterial} onChange={setEditMaterial} options={MATERIAL_OPTIONS} />
              <GarmentSelect id="edit-style" label="Style" value={editStyle} onChange={setEditStyle} options={STYLE_OPTIONS} />
              <GarmentSelect id="edit-season" label="Season" value={editSeason} onChange={setEditSeason} options={SEASON_OPTIONS} />
              <GarmentSelect id="edit-fit" label="Fit" value={editFit} onChange={setEditFit} options={FIT_OPTIONS} />
            </div>
            <div className="mt-4">
              <OccasionChips label="Best for (occasions)" value={editOccasions} onChange={setEditOccasions} />
            </div>
            <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: "var(--dim)" }}>
              <span className="h-5 w-5 rounded-full border" style={{ background: colorHexFor(editColor, editing.colorHex), borderColor: "var(--border)" }} aria-hidden="true" />
              <span>Swatch updates to {editColor} · files under {SLOT_LABEL[slotForCategory(editCategory, editing.slot)] ?? editCategory}</span>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label htmlFor="edit-price" className="mb-1.5 block text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>Price paid (₹)</label>
                <input id="edit-price" {...FIELDS.updateItem.price} type="number" value={editPrice} onChange={(e) => setEditPrice(e.target.value)} className="w-full rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
              <div>
                <label htmlFor="edit-mrp" className="mb-1.5 block text-xs font-bold uppercase tracking-wide" style={{ color: "var(--dim)" }}>MRP (₹) — optional</label>
                <input id="edit-mrp" {...FIELDS.updateItem.mrp} type="number" value={editMrp} onChange={(e) => setEditMrp(e.target.value)} placeholder="On the price tag" className="w-full rounded-xl border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
            </div>
            {discountPctOf(Number(editPrice) || 0, editMrp.trim() === "" ? null : Number(editMrp)) > 0 ? (
              <p className="mt-2 text-xs font-semibold" style={{ color: "var(--sage)" }}>You paid {discountPctOf(Number(editPrice) || 0, Number(editMrp))}% below MRP — cost-per-wear uses the price paid.</p>
            ) : <p className="mt-2 text-xs" style={{ color: "var(--faint)" }}>Cost-per-wear is worked out from the price paid, in ₹.</p>}
            {updError ? <p className="mt-3 text-sm" style={{ color: "var(--danger)" }} role="alert">{updError}</p> : null}
            <div className="mt-6 flex gap-2">
              <button type="submit" disabled={upd.isPending} className="btn-lift flex-1 rounded-full py-3 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{upd.isPending ? "Saving…" : "Save changes"}</button>
              <button type="button" onClick={() => setEditing(null)} className="btn-lift rounded-full border px-5 py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Cancel</button>
            </div>
          </form>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Add Clothing / AI scan ---------------- */

const SAMPLES = ["Navy shirt photo", "Cream overshirt photo", "Black tee photo", "Jeans photo", "Kurta photo", "Loafers photo"];

function AddClothing({ userId, go, toast }: { userId: number; go: (v: View) => void; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "scanning" | "done">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [sampleIdx, setSampleIdx] = useState(0);
  const [stepIdx, setStepIdx] = useState(0);
  // Editable scan-result form — pre-filled with the scan's starting guess,
  // fully correctable before anything is saved.
  const [formName, setFormName] = useState("");
  const [formCategory, setFormCategory] = useState("Shirt");
  const [formColor, setFormColor] = useState("Black");
  const [formPattern, setFormPattern] = useState("Solid");
  const [formMaterial, setFormMaterial] = useState("Cotton");
  const [formStyle, setFormStyle] = useState("Casual");
  const [formFit, setFormFit] = useState("Regular");
  const [formOccasions, setFormOccasions] = useState<string[]>([]);
  const [formFavorite, setFormFavorite] = useState(false);
  const [formSeason, setFormSeason] = useState("All Season");
  const [formPrice, setFormPrice] = useState("");
  const [formMrp, setFormMrp] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  /* The uploaded photo itself (downscaled) — saved with the item on
     Add, so the piece keeps its own photo in the wardrobe. Null for
     sample garments, which keep the stock imageKey visual instead. */
  const [photo, setPhoto] = useState<UploadedPhoto | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const scan = useMutation({ mutationFn: () => api.analyzeClothing({ userId, hint: fileName, sampleIndex: sampleIdx }) });

  // Pre-fill the form from each new scan result (once per result).
  const detectedForForm = scan.data?.detected;
  useEffect(() => {
    if (!detectedForForm) return;
    setFormName(detectedForForm.name);
    setFormCategory(detectedForForm.category);
    setFormColor(detectedForForm.color);
    setFormPattern(detectedForForm.pattern);
    setFormMaterial(detectedForForm.material);
    setFormStyle(detectedForForm.style);
    setFormFit(detectedForForm.fit);
    setFormOccasions(detectedForForm.occasions);
    setFormSeason(detectedForForm.season);
    setFormPrice(String(detectedForForm.suggestedPrice));
    setFormMrp(detectedForForm.suggestedMrp ? String(detectedForForm.suggestedMrp) : "");
  }, [detectedForForm]);

  const add = useMutation({
    mutationFn: () => {
      const d = scan.data!.detected;
      return api.addItem({
        userId,
        name: formName.trim() || d.name,
        category: formCategory, slot: slotForCategory(formCategory, d.slot),
        color: formColor, colorHex: colorHexFor(formColor, d.colorHex),
        pattern: formPattern, material: formMaterial, style: formStyle, season: formSeason,
        fit: formFit, occasions: formOccasions, favorite: formFavorite,
        formality: d.formality, price: Number(formPrice) || 0,
        mrp: formMrp.trim() === "" ? null : Number(formMrp) || null, imageKey: d.imageKey,
        photo,
      });
    },
    onSuccess: () => { qc.invalidateQueries(); toast("Added to your wardrobe ✦"); go("wardrobe"); },
    onError: (e) => setAddError(e instanceof Error ? e.message : "Couldn’t add that — check the name and try again."),
  });

  const startScan = (name: string, idx: number, url: string | null) => {
    setFileName(name); setSampleIdx(idx); setPreview(url); setPhase("scanning"); setStepIdx(0); scan.reset();
  };
  /* A real file pick/drop: validate + downscale the photo first. A
     non-image or unreadable file never starts a scan — the user gets
     a clear message and stays on the upload screen. */
  const handleFile = async (file: File) => {
    setPhotoError(null);
    try {
      const processed = await processPhotoFile(file);
      setPhoto(processed);
      startScan(file.name, Math.floor(Math.random() * 6), `data:${processed.mimeType};base64,${processed.dataBase64}`);
    } catch (e) {
      setPhoto(null);
      setPhotoError(e instanceof Error ? e.message : "That photo couldn't be used — try a different one.");
    }
  };
  useEffect(() => {
    if (phase !== "scanning") return;
    const timers = [350, 900, 1450, 2000, 2500].map((ms, i) => setTimeout(() => setStepIdx(i + 1), ms));
    const done = setTimeout(() => { scan.mutate(); setPhase("done"); }, 2900);
    return () => { timers.forEach(clearTimeout); clearTimeout(done); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase]);

  const detected = scan.data?.detected;
  const steps = scan.data?.steps ?? ["Looking at your photo", "Detecting category", "Detecting colour", "Understanding style & fit", "Drafting your starting guess"];
  const scanVisual = preview ?? (detected?.imageKey ? IMAGES[detected.imageKey] : undefined);

  return (
    <div className="mx-auto max-w-3xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Add Clothing</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>Teach WearWise a new piece.</h1>

      {phase === "idle" ? (
        <>
          <div className="mt-8 rounded-3xl border-2 border-dashed p-10 text-center" style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void handleFile(f); }}>
            <p className="font-display text-3xl" style={{ color: "var(--text)" }}>Drop your clothing photo here</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed" style={{ color: "var(--dim)" }}>WearWise will draft a starting guess for the name, category and colour — you review and fix every field before it’s added, so a wrong guess never sticks. Your photo is saved with the piece, so it stays on the item in your wardrobe.</p>
            <p className="mt-2 text-sm" style={{ color: "var(--dim)" }}>or</p>
            <button type="button" onClick={() => fileRef.current?.click()} className="btn-lift mt-3 rounded-full px-7 py-3 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Upload Image</button>
            <input ref={fileRef} type="file" accept="image/*" className="hidden" aria-label="Upload a clothing photo"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleFile(f); e.target.value = ""; }} />
          </div>
          {photoError ? <p className="mt-4 rounded-2xl border px-4 py-3 text-sm font-semibold" style={{ borderColor: "var(--danger)", color: "var(--danger)", background: "var(--surface)" }} role="alert">{photoError}</p> : null}
          <p className="mt-8 text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>No photo handy? Try a sample garment</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SAMPLES.map((s, i) => (
              <button key={s} type="button" onClick={() => { setPhoto(null); setPhotoError(null); startScan(s, i, null); }} className="btn-lift rounded-full border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>{s}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-8 grid gap-6 md:grid-cols-2">
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl border" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            {scanVisual ? <img src={scanVisual} alt={fileName || "Uploaded clothing"} className="h-full w-full object-cover" />
              : <div className="flex h-full items-center justify-center p-8 text-center"><p className="font-display text-2xl italic" style={{ color: "var(--dim)" }}>{fileName}</p></div>}
            {phase === "scanning" ? (
              <>
                <div className="scan-line absolute left-0 h-0.5 w-full" style={{ background: "var(--accent)", boxShadow: "0 0 24px 4px color-mix(in srgb, var(--accent) 65%, transparent)" }} aria-hidden="true" />
                <div className="absolute inset-x-0 bottom-0 p-4" style={{ background: "linear-gradient(to top, rgba(5,5,8,.85), transparent)" }}>
                  <p className="text-sm font-bold text-white">Preparing a starting guess…</p>
                </div>
              </>
            ) : null}
          </div>
          <div>
            {phase === "scanning" || !detected ? (
              <ul className="grid gap-3" aria-live="polite">
                {steps.map((s, i) => (
                  <li key={s} className="flex items-center gap-3 rounded-2xl border px-4 py-3.5" style={{ borderColor: "var(--border)", background: "var(--surface)", opacity: stepIdx > i ? 1 : 0.4, transition: "opacity .4s" }}>
                    <span className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold" style={{ background: stepIdx > i ? "var(--sage)" : "var(--border)", color: stepIdx > i ? "#0d120a" : "var(--dim)" }}>{stepIdx > i ? "✓" : "·"}</span>
                    <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{s}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <form className="anim-pop" onSubmit={(e) => { e.preventDefault(); if (!formName.trim()) { setNameError("Give this piece a name first — it’s how WearWise will refer to it."); return; } setNameError(null); setAddError(null); add.mutate(); }} aria-label="Review and edit scan result">
                <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--sage)" }}>Starting guess — check &amp; fix before you add</p>
                <h2 className="font-display mt-2 text-3xl font-medium" style={{ color: "var(--text)" }}>Does this look right?</h2>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>This is a starting guess, not a certain reading of your photo. Correct anything that’s wrong — what you save below is exactly what goes into your wardrobe and what the stylist will use.</p>

                <div className="mt-5">
                  <label htmlFor="scan-name" className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>Name</label>
                  <input id="scan-name" {...FIELDS.addItem.name} value={formName} onChange={(e) => setFormName(e.target.value)}
                    className="w-full rounded-xl border px-3.5 py-2.5 text-sm font-semibold" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }}
                    placeholder="e.g. My red hoodie" aria-label="Garment name" />
                  {nameError ? <p className="mt-1.5 text-xs font-semibold" style={{ color: "var(--danger)" }} role="alert">{nameError}</p> : null}
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <GarmentSelect id="scan-category" label="Category" value={formCategory} onChange={setFormCategory} options={CATEGORY_OPTIONS} />
                  <div>
                    <GarmentSelect id="scan-color" label="Colour" value={formColor} onChange={setFormColor} options={COLOR_OPTIONS.map((c) => c.name)} />
                  </div>
                  <GarmentSelect id="scan-pattern" label="Pattern" value={formPattern} onChange={setFormPattern} options={PATTERN_OPTIONS} />
                  <GarmentSelect id="scan-material" label="Material" value={formMaterial} onChange={setFormMaterial} options={MATERIAL_OPTIONS} />
                  <GarmentSelect id="scan-style" label="Style" value={formStyle} onChange={setFormStyle} options={STYLE_OPTIONS} />
                  <GarmentSelect id="scan-season" label="Season" value={formSeason} onChange={setFormSeason} options={SEASON_OPTIONS} />
                  <GarmentSelect id="scan-fit" label="Fit" value={formFit} onChange={setFormFit} options={FIT_OPTIONS} />
                </div>

                <div className="mt-4">
                  <OccasionChips label="Best for (occasions)" value={formOccasions} onChange={setFormOccasions} />
                </div>
                <button type="button" onClick={() => setFormFavorite((v) => !v)} aria-pressed={formFavorite}
                  className="btn-lift mt-4 rounded-full border px-4 py-2 text-xs font-bold"
                  style={formFavorite ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
                  {formFavorite ? "★ Favourite piece" : "☆ Mark as favourite"}
                </button>

                <div className="mt-3 flex items-center gap-2 text-xs" style={{ color: "var(--dim)" }}>
                  <span className="h-5 w-5 shrink-0 rounded-full border" style={{ background: colorHexFor(formColor, detected.colorHex), borderColor: "var(--border)" }} aria-hidden="true" />
                  <span>{formColor} · files as {SLOT_LABEL[slotForCategory(formCategory, detected.slot)] ?? formCategory} · {formCategory}</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <div>
                    <label htmlFor="scan-price" className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>Price paid (₹) — guess {inr(detected.suggestedPrice)}</label>
                    <input id="scan-price" {...FIELDS.addItem.price} type="number" value={formPrice} onChange={(e) => setFormPrice(e.target.value)}
                      className="w-full rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} aria-label="Price paid in rupees" />
                  </div>
                  <div>
                    <label htmlFor="scan-mrp" className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>MRP (₹) — on the tag, optional</label>
                    <input id="scan-mrp" {...FIELDS.addItem.mrp} type="number" value={formMrp} onChange={(e) => setFormMrp(e.target.value)} placeholder="e.g. 2999"
                      className="w-full rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} aria-label="MRP in rupees, optional" />
                  </div>
                </div>
                {discountPctOf(Number(formPrice) || 0, formMrp.trim() === "" ? null : Number(formMrp)) > 0 ? (
                  <p className="mt-2 text-xs font-semibold" style={{ color: "var(--sage)" }}>That’s {discountPctOf(Number(formPrice) || 0, Number(formMrp))}% off MRP — cost-per-wear will use the ₹ price you paid.</p>
                ) : <p className="mt-2 text-xs" style={{ color: "var(--faint)" }}>Cost-per-wear is worked out from the price paid, in ₹. Add the MRP from the tag and WearWise shows your discount too.</p>}

                {addError ? <p className="mt-3 text-sm" style={{ color: "var(--danger)" }} role="alert">{addError}</p> : null}

                {photo ? (
                  <div className="mt-4 flex flex-wrap items-center gap-2 text-xs" style={{ color: "var(--dim)" }}>
                    <span>Your photo will be saved with this piece — it stays on the item in your wardrobe, and you can replace or remove it later from Wardrobe → Edit.</span>
                    <button type="button" onClick={() => { setPhoto(null); setPreview(null); }} className="btn-lift rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Don’t save the photo</button>
                  </div>
                ) : null}

                <div className="mt-6 flex flex-wrap gap-2">
                  <button type="submit" disabled={add.isPending} className="btn-lift rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{add.isPending ? "Adding…" : "Add to Wardrobe"}</button>
                  <button type="button" onClick={() => go("stylist")} className="btn-lift rounded-full border px-6 py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Try an Outfit</button>
                  <button type="button" onClick={() => { setPhase("idle"); setPreview(null); setPhoto(null); }} className="btn-lift rounded-full border px-6 py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--dim)" }}>Scan another</button>
                </div>
                <p className="mt-3 text-xs" style={{ color: "var(--faint)" }}>You can fix any of this later too — Wardrobe → Edit covers the same fields.</p>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- AI Stylist ---------------- */

function Stylist({ userId, toast }: { userId: number; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const items = useItems(userId);
  const shared = useWearWiseOptional();
  const [occasion, setOccasion] = useState("College");
  const [weather, setWeather] = useState("Warm");
  const [style, setStyle] = useState("Smart Casual");
  const [seed, setSeed] = useState(0);
  const [showWhy, setShowWhy] = useState(false);
  const [chatSeed, setChatSeed] = useState(0);
  const [chatInput, setChatInput] = useState("");
  const [chatError, setChatError] = useState<string | null>(null);
  const [thread, setThread] = useState<Array<{ role: "user" | "ai"; text: string }>>([
    { role: "user", text: "I have a college presentation tomorrow. What should I wear?" },
  ]);

  const gen = useMutation({ mutationFn: () => api.generateOutfit({ userId, occasion, weather, style, seed }) });
  const ask = useMutation({
    mutationFn: (prompt: string) => api.stylistAsk({ userId, prompt, seed: chatSeed }),
    onSuccess: (d, prompt) => setThread((t) => [...t, { role: "user", text: prompt }, { role: "ai", text: d.reply }]),
  });
  const save = useMutation({
    mutationFn: (o: Outfit) => api.saveOutfit({ userId, title: o.title, itemIds: o.items.map((i) => i.id), occasion: o.title.split(" — ")[0] ?? "", matchScore: o.matchScore, explanation: o.explanation }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saved", userId] }); toast("Saved to your wardrobe ✦"); },
  });
  const wear = useMutation({
    mutationFn: (o: Outfit) => wardrobeService.markWorn(userId, o.items.map((i) => i.id)),
    onSuccess: (_d, o) => {
      /* MARK_OUTFIT_WORN: the store bumps every piece's wear count in
         the same transition the server persists (§16/§18 loop). */
      shared?.dispatch(storeActions.markOutfitWorn(null, o.items.map((i) => i.id)));
      qc.invalidateQueries(); toast("Marked as worn — nice choice ✦");
    },
  });
  const outfit = gen.data?.outfit ?? ask.data?.outfit;
  const generating = gen.isPending;
  useEffect(() => { if (ask.data) setShowWhy(false); }, [ask.data]);

  /* Remix, accessories & personalization — layered on the generated outfit */
  const [genPhase, setGenPhase] = useState(false);
  const remix = useMutation({
    mutationFn: (o: Outfit) => api.remixOutfit({ userId, itemIds: o.items.map((i) => i.id), occasion, weather, style }),
  });
  const accessories = useQuery({
    queryKey: ["accessories", userId, outfit?.items.map((i) => i.id).join(",") ?? "", occasion],
    queryFn: () => api.recommendAccessories({ userId, itemIds: outfit!.items.map((i) => i.id), occasion }),
    enabled: Boolean(outfit && outfit.items.length),
  });
  const [feedbackGiven, setFeedbackGiven] = useState<string | null>(null);
  const [feedbackReason, setFeedbackReason] = useState<string>("");
  const detailedFeedback = useMutation({
    mutationFn: (reason: string) => aiService.recordDetailedFeedback(userId, {
      rating: (feedbackGiven ?? "good") as "love" | "good" | "unsure" | "not",
      reason, detail: outfit ? outfit.title : "",
    }),
    onSuccess: (_d, reason) => setFeedbackReason(reason),
  });
  const feedback = useMutation({
    mutationFn: (rating: "love" | "good" | "unsure" | "not") => api.recordFeedback({ userId, rating, detail: outfit ? outfit.title : "" }),
    onSuccess: (_d, rating) => {
      setFeedbackGiven(rating);
      /* Feedback enters the shared state as an OutfitFeedback record —
         the personalization loop's input (§5/§18). */
      shared?.dispatch(storeActions.rateOutfit(null, RATING_TO_FEEDBACK[rating]));
    },
  });
  const runGenerate = () => {
    setGenPhase(true);
    setShowWhy(false);
    remix.reset();
    setFeedbackGiven(null);
    setFeedbackReason("");
    detailedFeedback.reset();
    shared?.dispatch(storeActions.setAiState("generateOutfit", "loading"));
    setTimeout(() => {
      setGenPhase(false);
      gen.mutate(undefined, {
        onSuccess: () => shared?.dispatch(storeActions.setAiState("generateOutfit", "success")),
        onError: (e) => shared?.dispatch(storeActions.setAiState("generateOutfit", "error", e instanceof Error ? e.message : "Generation failed")),
      });
    }, 1250);
  };

  const submitChat = (e: FormEvent) => {
    e.preventDefault();
    const p = chatInput.trim();
    if (!p) { setChatError("Ask something first — an occasion, a plan, a piece you’re unsure about."); return; }
    setChatError(null);
    setChatInput("");
    ask.mutate(p);
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>AI Stylist</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>Meet your AI stylist.</h1>

      <div className="mt-8 grid gap-6 lg:grid-cols-2">
        {/* Chat */}
        <section className="flex flex-col rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Stylist conversation">
          <div className="grid gap-4" aria-live="polite">
            {thread.map((m, i) => (
              <div key={i} className={m.role === "user" ? "justify-self-end" : "justify-self-start"} style={{ maxWidth: "88%" }}>
                <p className="mb-1 text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)", textAlign: m.role === "user" ? "right" : "left" }}>{m.role === "user" ? "You" : "WearWise AI"}</p>
                <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed" style={m.role === "user"
                  ? { background: "var(--accent)", color: "var(--accent-ink)", borderBottomRightRadius: 4 }
                  : { background: "var(--surface-2)", color: "var(--text)", borderBottomLeftRadius: 4 }}>
                  {m.text}
                </div>
              </div>
            ))}
            {ask.isPending ? <p className="text-sm" style={{ color: "var(--dim)" }}>Thinking through your wardrobe…</p> : null}
            {!ask.data && !ask.isPending && thread.length === 1 ? (
              <p className="text-sm italic" style={{ color: "var(--dim)" }}>Ask below, or tap a suggestion — the stylist answers from the {items.data?.items.length ?? 0} pieces you actually own.</p>
            ) : null}
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {["What should I wear for a date?", "Style me for festive season", "A travel outfit, please"].map((s) => (
              <button key={s} type="button" disabled={ask.isPending} onClick={() => { setChatSeed((x) => x + 1); ask.mutate(s); }} className="btn-lift rounded-full border px-3.5 py-2 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{s}</button>
            ))}
          </div>
          <form className="mt-4 flex gap-2" onSubmit={submitChat}>
            <label htmlFor="stylist-input" className="sr-only">Ask the AI stylist</label>
            <input id="stylist-input" {...FIELDS.stylistAsk.prompt} value={chatInput} onChange={(e) => setChatInput(e.target.value)} placeholder="I have a placement interview Monday…"
              className="min-w-0 flex-1 rounded-full border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
            <button type="submit" disabled={ask.isPending} className="btn-lift shrink-0 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Ask</button>
          </form>
          {chatError ? <p className="mt-2 text-xs font-semibold" style={{ color: "var(--danger)" }} role="alert">{chatError}</p> : null}
        </section>

        {/* Outfit generator */}
        <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Outfit generator">
          <div className="grid gap-5">
            <ChipRow label="Occasion" options={OCCASIONS} value={occasion} onChange={setOccasion} />
            <ChipRow label="Weather" options={WEATHERS} value={weather} onChange={setWeather} />
            <ChipRow label="Style" options={STYLES} value={style} onChange={setStyle} />
          </div>
          <button type="button" disabled={generating || genPhase || (items.data?.items.length ?? 0) === 0}
            onClick={() => { setSeed((s) => s + 1); runGenerate(); }}
            className="btn-lift mt-6 w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            {generating || genPhase ? "Styling your wardrobe…" : "Generate My Outfit"}
          </button>
          {genPhase ? <AiSteps steps={["Analyzing your wardrobe", "Understanding your style", "Finding the best combination", "Your outfit is ready"]} title="Styling your wardrobe" /> : null}
          {outfit && !genPhase ? (
            <div className="anim-fade-up mt-6 border-t pt-6" style={{ borderColor: "var(--border)" }} aria-live="polite">
              <div className="flex items-center justify-between">
                <h3 className="font-display text-2xl" style={{ color: "var(--text)" }}>Your outfit is ready.</h3>
                <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{outfit.matchScore}% Match</span>
              </div>
              <div className="mt-4"><OutfitStrip outfit={outfit} /></div>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{outfit.explanation}</p>
              {gen.data ? (
                <div className="anim-fade-up mt-4 rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }} aria-label="Why WearWise recommends this">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "var(--accent)" }}>Why WearWise recommends this</p>
                    <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: "var(--surface)", color: "var(--text)", border: "1px solid var(--border)" }} title={confidenceLabel(gen.data.confidence)}>AI Confidence {gen.data.confidence}%</span>
                  </div>
                  <ul className="mt-2.5 grid gap-1.5">
                    {gen.data.reasons.map((r) => (
                      <li key={r} className="flex items-start gap-2 text-sm" style={{ color: "var(--text)" }}>
                        <span className="mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold" style={{ background: "var(--sage)", color: "#0d120a" }}>✓</span>{r}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" onClick={() => setShowWhy((w) => !w)} aria-expanded={showWhy} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Why This Works</button>
                <button type="button" disabled={save.isPending} onClick={() => save.mutate(outfit)} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Save Outfit</button>
                <button type="button" disabled={wear.isPending} onClick={() => wear.mutate(outfit)} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Wear This</button>
                <button type="button" disabled={remix.isPending} onClick={() => remix.mutate(outfit)} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>↻ Remix</button>
                <button type="button" onClick={() => { setChatSeed((x) => x + 1); if (ask.data) ask.mutate(thread.filter((t) => t.role === "user").at(-1)?.text ?? "Style me"); else { setSeed((s) => s + 1); runGenerate(); } }} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Try Another</button>
              </div>
              {showWhy ? (
                <div className="anim-fade-up mt-5">
                  <p className="mb-3 text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>Why this works</p>
                  <FactorBars outfit={outfit} />
                </div>
              ) : null}

              {/* Remix results — same style, 1–2 pieces changed */}
              {remix.isPending ? <p className="mt-5 text-sm" style={{ color: "var(--dim)" }}>Remixing — keeping the style, swapping a piece or two…</p> : null}
              {(remix.data?.remixes.length ?? 0) > 0 ? (
                <div className="anim-fade-up mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>Remix this outfit — compare</p>
                  <div className="mt-4 grid gap-4">
                    {remix.data!.remixes.map((r, ri) => (
                      <article key={ri} className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h4 className="text-sm font-bold" style={{ color: "var(--text)" }}>Remix {ri + 1}</h4>
                          <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{r.outfit.matchScore}% Match</span>
                        </div>
                        <p className="mt-1 text-xs" style={{ color: "var(--dim)" }}>Changed: {r.changed}</p>
                        <div className="mt-3"><OutfitStrip outfit={r.outfit} compact /></div>
                        <button type="button" disabled={save.isPending} onClick={() => save.mutate(r.outfit)} className="btn-lift mt-3 rounded-full border px-4 py-1.5 text-xs font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Save this remix</button>
                      </article>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Accessory recommender */}
              {accessories.data ? (
                <div className="anim-fade-up mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
                  <p className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>Finish the look</p>
                  <p className="mt-2 text-sm italic leading-relaxed" style={{ color: "var(--dim)" }}>“{accessories.data.note}”</p>
                  <ul className="mt-3 grid gap-2">
                    {accessories.data.suggestions.map((s) => (
                      <li key={s.type} className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{s.name} {s.owned ? <span className="ml-1 rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: "color-mix(in srgb, var(--sage) 22%, transparent)", color: "var(--sage)" }}>YOU OWN THIS</span> : null}</p>
                        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{s.reason}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {/* Personalization feedback */}
              <div className="mt-6 border-t pt-5" style={{ borderColor: "var(--border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>How would you wear this?</p>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Rate this outfit">
                  {([["love", "❤️ Love it"], ["good", "👍 Good"], ["unsure", "😐 Not sure"], ["not", "👎 Not my style"]] as Array<["love" | "good" | "unsure" | "not", string]>).map(([rating, label]) => (
                    <button key={rating} type="button" disabled={feedback.isPending} aria-pressed={feedbackGiven === rating}
                      onClick={() => feedback.mutate(rating)}
                      className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold disabled:opacity-50"
                      style={feedbackGiven === rating ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)" }}>
                      {label}
                    </button>
                  ))}
                </div>
                {feedback.data ? (
                  <p className="anim-fade-up mt-3 text-sm" style={{ color: "var(--sage)" }} role="status">✦ WearWise is learning your style. {feedback.data.learnedNote}</p>
                ) : null}
                {feedbackGiven ? (
                  <div className="anim-fade-up mt-4">
                    <p className="text-xs font-semibold" style={{ color: "var(--dim)" }}>Tell WearWise why — this teaches the Preference Engine specifically:</p>
                    <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Feedback reason">
                      {FEEDBACK_REASONS.map((reason) => (
                        <button key={reason} type="button" disabled={detailedFeedback.isPending} aria-pressed={feedbackReason === reason}
                          onClick={() => detailedFeedback.mutate(reason)}
                          className="btn-lift rounded-full border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50"
                          style={feedbackReason === reason ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)" }}>
                          {reason}
                        </button>
                      ))}
                    </div>
                    {detailedFeedback.data ? (
                      <p className="anim-fade-up mt-2.5 text-sm" style={{ color: "var(--sage)" }} role="status">✦ {detailedFeedback.data.preferenceEffect}</p>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}
        </section>
      </div>

      <OccasionTransformer userId={userId} />
      <SavedOutfits userId={userId} toast={toast} />
    </div>
  );
}

/* One hero item, five occasions — the outfit rebuilds around it live. */
function OccasionTransformer({ userId }: { userId: number }) {
  const items = useItems(userId);
  const all = items.data?.items ?? [];
  const heroes = all.filter((i) => i.slot === "top" || i.slot === "ethnic");
  const [heroId, setHeroId] = useState<number | null>(null);
  const hero = heroes.find((i) => i.id === heroId) ?? heroes.find((i) => i.color.toLowerCase() === "white") ?? heroes[0] ?? null;
  const [occ, setOcc] = useState("College");
  const tQ = useQuery({
    queryKey: ["transform", userId, hero?.id],
    queryFn: () => api.transformItem({ userId, itemId: hero!.id }),
    enabled: Boolean(hero),
  });
  const activeLook = tQ.data?.looks.find((l) => l.occasion === occ) ?? tQ.data?.looks[0];
  if (!hero) return null;
  return (
    <section className="mt-10 rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Occasion transformer">
      <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>✦ Occasion Transformer</p>
      <h2 className="font-display mt-2 text-3xl font-medium" style={{ color: "var(--text)" }}>One piece. Five lives.</h2>
      <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Pick a hero piece — WearWise restyles it for every occasion, including festive ones: kurta + jeans + sneakers for casual, kurta + Nehru-style layer + loafers for a wedding.</p>
      <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Choose hero item">
        {heroes.slice(0, 8).map((i) => (
          <button key={i.id} type="button" onClick={() => { setHeroId(i.id); }} aria-pressed={hero.id === i.id}
            className="btn-lift shrink-0 rounded-full border px-4 py-2 text-xs font-semibold"
            style={hero.id === i.id ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface-2)" }}>
            {i.name}
          </button>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2" role="tablist" aria-label="Choose occasion">
        {(tQ.data?.looks ?? []).map((l) => (
          <button key={l.occasion} type="button" role="tab" aria-selected={occ === l.occasion} onClick={() => setOcc(l.occasion)}
            className="btn-lift rounded-full border px-4 py-2 text-sm font-semibold"
            style={occ === l.occasion ? { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" } : { borderColor: "var(--border)", color: "var(--text)" }}>
            {l.occasion}
          </button>
        ))}
      </div>
      {activeLook ? (
        <div key={`${hero.id}-${activeLook.occasion}`} className="anim-pop mt-5">
          <div className="flex items-center gap-3">
            <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{activeLook.outfit.matchScore}% Match</span>
            <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{hero.name} for {activeLook.occasion}</p>
          </div>
          <div className="mt-4"><OutfitStrip outfit={activeLook.outfit} /></div>
          <p className="mt-3 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{activeLook.outfit.explanation}</p>
        </div>
      ) : <p className="mt-5 text-sm" style={{ color: "var(--dim)" }}>Transforming…</p>}
    </section>
  );
}

function SavedOutfits({ userId, toast }: { userId: number; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const saved = useQuery({ queryKey: ["saved", userId], queryFn: () => api.listSavedOutfits({ userId }) });
  const del = useMutation({
    mutationFn: (id: number) => api.deleteSavedOutfit({ userId, outfitId: id }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["saved", userId] }); toast("Outfit removed"); },
  });
  const list = saved.data?.outfits ?? [];
  if (!saved.isPending && list.length === 0) return null;
  return (
    <section className="mt-10" aria-label="Saved outfits">
      <h2 className="font-display text-3xl font-medium" style={{ color: "var(--text)" }}>Saved outfits</h2>
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {list.map((o) => (
          <article key={o.id} className="card-lift rounded-3xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold" style={{ color: "var(--text)" }}>{o.title}</h3>
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{o.matchScore}%</span>
            </div>
            <div className="mt-3"><OutfitStrip outfit={{ title: o.title, items: o.items, matchScore: o.matchScore, explanation: o.explanation, factors: [] }} compact /></div>
            <button type="button" onClick={() => del.mutate(o.id)} className="btn-lift mt-3 text-xs font-semibold" style={{ color: "var(--danger)" }}>Remove outfit</button>
          </article>
        ))}
      </div>
    </section>
  );
}

/* ---------------- Buy or Skip ---------------- */

const BUY_SAMPLES = [
  { name: "PUMA T7 Tee — Black", brand: "PUMA", price: 2499, mrp: null as number | null, color: "Black", slot: "top", style: "Streetwear", imageKey: "blacktee" as string | null, productUrl: "https://in.puma.com/in/en/pd/t7-mens-tee/629592?size=0160&swatch=36", retailer: "Puma India" },
  { name: "Nike Ava X Mesh Shoes — Black", brand: "Nike", price: 8636, mrp: 10795 as number | null, color: "Black", slot: "shoes", style: "Sporty", imageKey: null, productUrl: "https://www.nike.in/nike-ava-x-mesh-men-s-shoes/p/27764015", retailer: "Nike India" },
  { name: "Manyavar Sunset Mustard Kurta Set", brand: "Manyavar", price: 3999, mrp: null as number | null, color: "Yellow", slot: "ethnic", style: "Traditional", imageKey: null, productUrl: "https://www.manyavar.com/en-in/full-length-kurta-pajama/sunset-mustard-elegance-kurta-pajama/M415351.html", retailer: "Manyavar" },
  { name: "Levi's 511 Selvedge Jeans — Dark Blue", brand: "Levi's", price: 5599, mrp: null as number | null, color: "Blue", slot: "bottom", style: "Casual", imageKey: null, productUrl: "https://www.nykaaman.com/levi-s-mens-511-dark-blue-slim-fit-mid-rise-selvedge-jeans/p/24041366?ptype=product&skuId=24040809", retailer: "Nykaa Man" },
];

function BuySkip({ userId, go }: { userId: number; go: (v: View) => void }) {
  const qc = useQueryClient();
  const [sel, setSel] = useState(0);
  const [customName, setCustomName] = useState("");
  const [nameError, setNameError] = useState<string | null>(null);
  const [customPrice, setCustomPrice] = useState("");
  const [customMrp, setCustomMrp] = useState("");
  const [scanning, setScanning] = useState(false);
  const [lastReq, setLastReq] = useState<{ productName: string; price: number; mrp: number | null; color: string; slot: string; style: string } | null>(null);
  const dup = useMutation({ mutationFn: (p: { productName: string; color: string; slot: string; style: string }) => api.detectDuplicates({ userId, ...p }) });
  const sim = useMutation({ mutationFn: (p: { productName: string; price: number; color: string; slot: string; style: string }) => api.simulatePurchase({ userId, ...p }) });
  const history = useQuery({ queryKey: ["analyses", userId], queryFn: () => api.listAnalyses({ userId, limit: 6 }) });
  const analyze = useMutation({
    mutationFn: (p: { productName: string; price: number; mrp: number | null; color: string; slot: string; style: string }) => api.analyzePurchase({ userId, ...p }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["analyses", userId] }),
  });
  const sample = BUY_SAMPLES[sel] ?? BUY_SAMPLES[0]!;
  const result: Analysis | undefined = analyze.data?.analysis;

  const runSample = (i: number) => {
    setSel(i);
    const s = BUY_SAMPLES[i] ?? BUY_SAMPLES[0]!;
    setScanning(true);
    analyze.reset(); dup.reset(); sim.reset();
    const req = { productName: s.name, price: s.price, mrp: s.mrp, color: s.color, slot: s.slot, style: s.style };
    setLastReq(req);
    setTimeout(() => { setScanning(false); analyze.mutate(req); }, 1500);
  };
  const runCustom = (e: FormEvent) => {
    e.preventDefault();
    if (!customName.trim()) { setNameError("Type the product’s name first — that’s what WearWise scores against your wardrobe."); return; }
    setNameError(null);
    setScanning(true);
    analyze.reset(); dup.reset(); sim.reset();
    const req = { productName: customName.trim(), price: Number(customPrice) || 0, mrp: customMrp.trim() === "" ? null : Number(customMrp) || null, color: "", slot: "top", style: "" };
    setLastReq(req);
    setTimeout(() => { setScanning(false); analyze.mutate(req); }, 1300);
  };

  const verdictColor = result?.verdict === "BUY" ? "var(--sage)" : result?.verdict === "SKIP" ? "var(--danger)" : "var(--accent)";

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Buy or Skip</p>
      <h1 className="font-display mt-2 max-w-2xl text-4xl leading-[1.05] font-medium md:text-5xl" style={{ color: "var(--text)" }}>Before you buy it, ask WearWise.</h1>
      <p className="mt-3 max-w-xl" style={{ color: "var(--dim)" }}>These samples are real products from real brands at real prices. Pick one — or type any product — and let AI decide whether it belongs in your wardrobe.</p>

      <div className="mt-6 flex flex-wrap gap-2" role="group" aria-label="Sample products">
        {BUY_SAMPLES.map((s, i) => (
          <button key={s.name} type="button" onClick={() => runSample(i)} aria-pressed={sel === i && Boolean(result)}
            className="btn-lift rounded-full border px-4 py-2.5 text-sm font-semibold"
            style={sel === i ? { borderColor: "var(--accent)", color: "var(--text)", background: "var(--surface-2)" } : { borderColor: "var(--border)", color: "var(--dim)", background: "var(--surface)" }}>
            {s.brand} · {inr(s.price)}{discountPctOf(s.price, s.mrp) > 0 ? ` · ${discountPctOf(s.price, s.mrp)}% off MRP` : ""}
          </button>
        ))}
      </div>
      <form className="mt-4 flex flex-wrap gap-2" onSubmit={runCustom}>
        <label htmlFor="buy-name" className="sr-only">Product name to analyze</label>
        <input id="buy-name" {...FIELDS.analyzePurchase.productName} value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder="Or type any product — e.g. Olive Cargo Pants"
          className="min-w-56 flex-1 rounded-full border px-4 py-2.5 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} />
        <label htmlFor="buy-price" className="sr-only">Selling price in rupees</label>
        <input id="buy-price" {...FIELDS.analyzePurchase.price} type="number" value={customPrice} onChange={(e) => setCustomPrice(e.target.value)} placeholder="₹ Selling price"
          className="w-32 rounded-full border px-4 py-2.5 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} />
        <label htmlFor="buy-mrp" className="sr-only">MRP in rupees, optional</label>
        <input id="buy-mrp" {...FIELDS.analyzePurchase.mrp} type="number" value={customMrp} onChange={(e) => setCustomMrp(e.target.value)} placeholder="₹ MRP (optional)"
          className="w-36 rounded-full border px-4 py-2.5 text-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} />
        <button type="submit" className="btn-lift rounded-full px-6 py-2.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Analyze a Product</button>
      </form>
      {nameError ? <p className="mt-2 text-sm font-semibold" style={{ color: "var(--danger)" }} role="alert">{nameError}</p> : null}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.3fr]">
        <div className="overflow-hidden rounded-3xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
          <div className="relative aspect-[4/3]">
            {sample.imageKey && IMAGES[sample.imageKey] ? <img src={IMAGES[sample.imageKey]} alt={sample.name} className="h-full w-full object-cover" />
              : <div className="flex h-full items-center justify-center" style={{ background: "var(--surface-2)" }}><span className="font-display text-3xl italic" style={{ color: "var(--dim)" }}>{sample.name}</span></div>}
            {scanning ? <div className="scan-line absolute left-0 h-0.5 w-full" style={{ background: "var(--accent)", boxShadow: "0 0 24px 4px color-mix(in srgb, var(--accent) 65%, transparent)" }} aria-hidden="true" /> : null}
          </div>
          <div className="p-5">
            <p className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>{sample.brand} · Real product</p>
            <h2 className="font-display mt-1 text-2xl" style={{ color: "var(--text)" }}>{result?.productName ?? sample.name}</h2>
            <p className="mt-1.5"><PriceBlock price={result?.price ?? sample.price} mrp={result ? result.mrp : sample.mrp} big /></p>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{sample.style} · on {sample.retailer} · checked against your full wardrobe</p>
            <a href={sample.productUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs font-bold underline underline-offset-2" style={{ color: "var(--accent)" }}>See it on {sample.retailer} ↗</a>
          </div>
        </div>

        <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="AI purchase analysis" aria-live="polite">
          {scanning || analyze.isPending ? (
            <AiSteps steps={["Scanning product", "Comparing with wardrobe", "Checking outfit compatibility", "Calculating wardrobe value"]} title="Analyzing against your wardrobe" />
          ) : result ? (
            <div className="anim-fade-up">
              <div className="flex flex-wrap items-center gap-6">
                <ScoreRing score={result.score} size={128} label="Wardrobe Value" />
                <div>
                  <p className="font-display text-5xl font-semibold tracking-wide" style={{ color: verdictColor }}>{result.verdict}</p>
                  <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>Unlocks ~{result.projectedOutfits} outfits · projected {result.projectedCostPerWear ? `${inr(result.projectedCostPerWear)}/wear` : "—"}</p>
                  {result.discountPct > 0 && result.mrp ? <p className="mt-1 text-sm font-semibold" style={{ color: "var(--sage)" }}>{result.discountPct}% off MRP {inr(result.mrp)} — you pay {inr(result.price)}</p> : null}
                </div>
              </div>
              <ul className="mt-6 grid gap-2">
                {result.reasons.map((r) => (
                  <li key={r} className="flex items-start gap-2.5 text-sm" style={{ color: "var(--text)" }}>
                    <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={{ background: "var(--sage)", color: "#0d120a" }}>✓</span>{r}
                  </li>
                ))}
              </ul>
              {result.cautions.length ? (
                <div className="mt-4 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  {result.cautions.map((c) => <p key={c} className="text-sm" style={{ color: "var(--danger)" }}>⚠ {c}</p>)}
                </div>
              ) : null}
              <div className="mt-6 rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "var(--dim)" }}>How the verdict breaks down</p>
                <div className="mt-3 grid gap-3">
                  {([
                    ["Wardrobe value", result.score, undefined],
                    ["Compatibility with your pieces", result.compatibilityScore, undefined],
                    ["Versatility across occasions", result.versatilityScore, undefined],
                    ["Duplicate risk", result.duplicateScore, result.duplicateScore >= 48 ? "var(--danger)" : "var(--sage)"],
                  ] as Array<[string, number, string | undefined]>).map(([label, val, col]) => (
                    <div key={label}>
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: "var(--dim)" }}>{label}</span>
                        <span className="font-bold" style={{ color: "var(--text)" }}>{val}%</span>
                      </div>
                      <div className="mt-1"><Bar pct={val} color={col} /></div>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>Wardrobe impact: <span className="font-semibold" style={{ color: "var(--text)" }}>{result.wardrobeImpact}</span></p>
                <div className="mt-3 grid gap-3">
                  {([
                    ["Wardrobe ROI — value this adds", result.roiScore],
                    ["AI Confidence", result.confidence],
                  ] as Array<[string, number]>).map(([label, val]) => (
                    <div key={label}>
                      <div className="flex items-center justify-between text-xs">
                        <span style={{ color: "var(--dim)" }}>{label}</span>
                        <span className="font-bold" style={{ color: "var(--text)" }}>{val}/100</span>
                      </div>
                      <div className="mt-1"><Bar pct={val} /></div>
                    </div>
                  ))}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed" style={{ color: "var(--faint)" }}>{confidenceLabel(result.confidence)} — confidence reflects how much wardrobe and product data backs this verdict.</p>
              </div>
              <div className="mt-5 border-t pt-5" style={{ borderColor: "var(--border)" }}>
                <p className="text-[10px] font-bold tracking-[0.2em] uppercase" style={{ color: "var(--accent)" }}>WearWise Verdict</p>
                <p className="font-display mt-2 text-2xl italic leading-snug" style={{ color: "var(--text)" }}>“{result.verdictText}”</p>
              </div>
              {result.verdict !== "SKIP" ? (
                <button type="button" onClick={() => go("shop")} className="btn-lift mt-5 rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>See pieces that score higher →</button>
              ) : null}
            </div>
          ) : (
            <div className="flex h-full min-h-56 flex-col items-center justify-center gap-3 text-center">
              <p className="font-display text-2xl italic" style={{ color: "var(--text)" }}>Pick a product above to run the verdict.</p>
              <p className="max-w-sm text-sm" style={{ color: "var(--dim)" }}>Start with the PUMA T7 Tee: a real ₹2,499 product that matches plenty you own — but you may already own a near-identical black tee.</p>
            </div>
          )}
        </section>
      </div>

      {result && lastReq ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          {/* Duplicate Detector */}
          <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Duplicate detector">
            <h2 className="font-display text-2xl font-medium" style={{ color: "var(--text)" }}>Similar Items Found</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>The duplicate check compares colour, category, style and slot against everything you own.</p>
            {!dup.data && !dup.isPending ? (
              <button type="button" onClick={() => dup.mutate({ productName: lastReq.productName, color: lastReq.color, slot: lastReq.slot, style: lastReq.style })} className="btn-lift mt-4 rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Run Duplicate Check</button>
            ) : null}
            {dup.isPending ? <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>Scanning your wardrobe for lookalikes…</p> : null}
            {dup.data ? (
              <div className="anim-fade-up mt-4">
                <ul className="grid gap-3">
                  {dup.data.similar.map(({ item, similarity }) => (
                    <li key={item.id} className="rounded-2xl border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{item.name}</span>
                        <span className="text-sm font-bold" style={{ color: similarity >= 80 ? "var(--danger)" : "var(--accent)" }}>{similarity}% similar</span>
                      </div>
                      <div className="mt-2"><Bar pct={similarity} color={similarity >= 80 ? "var(--danger)" : undefined} /></div>
                      <p className="mt-1.5 text-xs" style={{ color: "var(--dim)" }}>{item.color} · {item.category} · worn {item.wornCount} times</p>
                    </li>
                  ))}
                </ul>
                <p className="font-display mt-4 text-lg italic" style={{ color: "var(--text)" }}>“{dup.data.message}”</p>
                {dup.data.count > 0 ? <button type="button" onClick={() => go("wardrobe")} className="btn-lift mt-3 rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>View Similar Items</button> : null}
              </div>
            ) : null}
          </section>

          {/* What If I Bought This */}
          <section className="rounded-3xl border p-6" style={{ background: "linear-gradient(150deg, var(--surface), var(--surface-2))", borderColor: "var(--border)" }} aria-label="What if I bought this">
            <h2 className="font-display text-2xl font-medium" style={{ color: "var(--text)" }}>What would this add to your wardrobe?</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>A simulation, not a sales pitch: real outfits this piece would join, counted from your clothes.</p>
            {!sim.data && !sim.isPending ? (
              <button type="button" onClick={() => sim.mutate({ productName: lastReq.productName, price: lastReq.price, color: lastReq.color, slot: lastReq.slot, style: lastReq.style })} className="btn-lift mt-4 rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Simulate This Purchase</button>
            ) : null}
            {sim.isPending ? <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>Building outfits with it…</p> : null}
            {sim.data ? (
              <div className="anim-fade-up mt-4">
                <p className="text-xs font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>Works with</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {sim.data.worksWith.map((w) => <span key={w} className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{w}</span>)}
                </div>
                <ul className="mt-4 grid gap-2">
                  {sim.data.outfits.map((o) => (
                    <li key={o.title} className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-2.5" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                      <span className="text-xs leading-relaxed" style={{ color: "var(--text)" }}>{o.pieces.join(" + ")}</span>
                      <span className="shrink-0 text-xs font-bold" style={{ color: "var(--accent)" }}>{o.score}%</span>
                    </li>
                  ))}
                </ul>
                <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                  <div className="rounded-2xl border px-2 py-3" style={{ borderColor: "var(--border)" }}><p className="font-display text-2xl" style={{ color: "var(--text)" }}>+{sim.data.combosAdded}</p><p className="text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Combinations</p></div>
                  <div className="rounded-2xl border px-2 py-3" style={{ borderColor: "var(--border)" }}><p className="font-display text-2xl" style={{ color: "var(--text)" }}>+{sim.data.newCategories}</p><p className="text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Outfit categories</p></div>
                  <div className="rounded-2xl border px-2 py-3" style={{ borderColor: "var(--border)" }}><p className="font-display text-lg leading-8" style={{ color: sim.data.duplication.startsWith("Low") ? "var(--sage)" : "var(--danger)" }}>{sim.data.duplication.replace(" duplication", "")}</p><p className="text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Duplication</p></div>
                </div>
                <p className="font-display mt-4 text-3xl font-semibold tracking-wide" style={{ color: sim.data.verdict === "BUY" ? "var(--sage)" : "var(--danger)" }}>{sim.data.verdict}</p>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {(history.data?.analyses.length ?? 0) > 0 ? (
        <section className="mt-10" aria-label="Past analyses">
          <h2 className="font-display text-2xl font-medium" style={{ color: "var(--text)" }}>Your past verdicts</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {history.data!.analyses.map((a) => (
              <article key={a.id} className="rounded-2xl border p-4" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold" style={{ color: "var(--text)" }}>{a.productName}</h3>
                  <span className="text-xs font-bold" style={{ color: a.verdict === "BUY" ? "var(--sage)" : a.verdict === "SKIP" ? "var(--danger)" : "var(--accent)" }}>{a.verdict} · {a.score}%</span>
                </div>
                <p className="mt-1.5"><PriceBlock price={a.price} mrp={a.mrp} /></p>
                <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{a.verdictText}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

/* ---------------- Smart Shop ---------------- */

function Shop({ userId, toast, go }: { userId: number; toast: (m: string) => void; go: (v: View) => void }) {
  const products = useQuery({ queryKey: ["products", userId], queryFn: () => api.recommendProducts({ userId }) });
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [brandFilter, setBrandFilter] = useState("All brands");
  const allProducts = products.data?.products ?? [];
  const shopBrands = useMemo(() => ["All brands", ...new Set(allProducts.map((x) => x.brand))], [allProducts]);
  const list = brandFilter === "All brands" ? allProducts : allProducts.filter((x) => x.brand === brandFilter);
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Smart Shop · Real Products</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>Don’t buy more. Buy smarter.</h1>
      <p className="mt-3 max-w-xl" style={{ color: "var(--dim)" }}>Every product below is real — a real brand, a real Indian price from a live catalog (checked 13 Nov 2026), and a real product page. Where the retailer lists an MRP above the selling price, you’ll see it struck through with the % off — the way Myntra, Ajio, Flipkart and Amazon.in show it. WearWise scores each one against the wardrobe you already own. Tap View Product to see photos and buy on the retailer’s site.</p>
      <div className="mt-5 flex flex-wrap items-center gap-2">
        <span className="rounded-full border px-3.5 py-1.5 text-xs font-bold" style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>{allProducts.length} real products</span>
        <span className="rounded-full border px-3.5 py-1.5 text-xs font-bold" style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>{products.data?.brandsInCatalog ?? 0} brands in shop</span>
        <button type="button" onClick={() => go("brands")} className="btn-lift rounded-full border px-3.5 py-1.5 text-xs font-bold" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Browse all brands A–Z →</button>
      </div>
      <div className="mt-6 flex gap-2 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Filter shop by brand">
        {shopBrands.map((b) => (
          <button key={b} type="button" onClick={() => setBrandFilter(b)} aria-pressed={brandFilter === b}
            className="btn-lift shrink-0 rounded-full border px-4 py-2 text-sm font-semibold"
            style={brandFilter === b ? { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
            {b}
          </button>
        ))}
      </div>
      {products.isPending ? <p className="mt-10 text-sm" style={{ color: "var(--dim)" }}>Scoring real products against your wardrobe…</p> : (
        <div className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {list.map((prod: Product) => (
            <article key={prod.id} className="card-lift overflow-hidden rounded-3xl border" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="relative aspect-[4/3]">
                {prod.imageKey && IMAGES[prod.imageKey] ? <img src={IMAGES[prod.imageKey]} alt={`${prod.brand} ${prod.name}`} className="h-full w-full object-cover" loading="lazy" />
                  : <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-3 text-center" style={{ background: `linear-gradient(150deg, ${prod.colorHex}, ${prod.colorHex}cc 55%, #00000055)` }} aria-hidden="true">
                      <span className="font-display text-4xl italic" style={{ color: "rgba(255,255,255,.9)" }}>{prod.brand.charAt(0)}</span>
                      <span className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "rgba(255,255,255,.85)" }}>{prod.brand}</span>
                      <span className="text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: "rgba(255,255,255,.65)" }}>{prod.category} · {prod.color}</span>
                    </div>}
                <span className="absolute top-3 right-3 rounded-full px-3 py-1 text-xs font-bold shadow" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{prod.match}% Wardrobe Match</span>
                <span className="absolute top-3 left-3 rounded-full px-2.5 py-1 text-[10px] font-bold tracking-wide shadow" style={{ background: "rgba(10,10,12,.72)", color: "#fff" }}>{prod.brand}</span>
              </div>
              <div className="p-5">
                <p className="text-[10px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--accent)" }}>{prod.brand} · Sold by {prod.retailer}</p>
                <div className="mt-1 flex items-start justify-between gap-2">
                  <h2 className="font-display text-[22px] leading-tight" style={{ color: "var(--text)" }}>{prod.name}</h2>
                  <div className="shrink-0 text-right"><PriceBlock price={prod.price} mrp={prod.mrp} /></div>
                </div>
                <p className="mt-1 text-[11px]" style={{ color: "var(--faint)" }}>{prod.discountPct > 0 ? "Indian MRP, incl. of all taxes · selling price on " + prod.retailer : "Priced at MRP on " + prod.retailer}</p>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{prod.note}</p>
                <div className="mt-3"><Bar pct={prod.match} /></div>
                <div className="mt-4 flex gap-2">
                  <a href={prod.productUrl} target="_blank" rel="noreferrer" className="btn-lift flex flex-1 items-center justify-center rounded-full py-2.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>View Product ↗</a>
                  <button type="button" aria-pressed={savedIds.has(prod.id)} onClick={() => { setSavedIds((s) => { const n = new Set(s); if (n.has(prod.id)) n.delete(prod.id); else n.add(prod.id); return n; }); toast(savedIds.has(prod.id) ? "Removed from your shortlist" : "Shortlisted ✦"); }}
                    className="btn-lift rounded-full border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: savedIds.has(prod.id) ? "var(--accent)" : "var(--text)" }}>
                    {savedIds.has(prod.id) ? "★ Shortlisted" : "☆ Shortlist"}
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {list.length === 0 && !products.isPending ? <p className="mt-10 text-sm" style={{ color: "var(--dim)" }}>No products from that brand in the shop right now — try another brand.</p> : null}
    </div>
  );
}

/* ---------------- Brands directory ---------------- */

function Brands({ userId, go }: { userId: number | null; go: (v: View) => void }) {
  const brandsQ = useQuery({ queryKey: ["brands", userId], queryFn: () => api.listBrands(userId ? { userId } : {}) });
  const [group, setGroup] = useState("All");
  const [q, setQ] = useState("");
  const allBrands = brandsQ.data?.brands ?? [];
  const groups = useMemo(() => ["All", ...new Set(allBrands.map((b) => b.group))], [allBrands]);
  const filtered = allBrands.filter((b) => (group === "All" || b.group === group) && b.name.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Brand Directory</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>60 brands. One wardrobe.</h1>
      <p className="mt-3 max-w-xl" style={{ color: "var(--dim)" }}>{brandsQ.data?.totalBrands ?? 60} major clothing brands that exist and sell in India — global fashion, sportswear, denim, formal and ethnic. Brands marked “In WearWise” have real products in your wardrobe or Smart Shop today; the rest are listed so you can browse the wider landscape — WearWise only claims real products for the marked brands.</p>
      <div className="mt-6 flex flex-wrap gap-2">
        <label htmlFor="brand-search" className="sr-only">Search brands</label>
        <input id="brand-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a brand — Nike, Manyavar, Zara…"
          className="min-w-56 flex-1 rounded-full border px-4 py-2.5 text-sm sm:max-w-sm" style={{ background: "var(--surface)", borderColor: "var(--border)", color: "var(--text)" }} />
      </div>
      <div className="mt-4 flex gap-2 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Filter brands by group">
        {groups.map((g) => (
          <button key={g} type="button" onClick={() => setGroup(g)} aria-pressed={group === g}
            className="btn-lift shrink-0 rounded-full border px-4 py-2 text-sm font-semibold"
            style={group === g ? { background: "var(--text)", color: "var(--bg)", borderColor: "var(--text)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
            {g}
          </button>
        ))}
      </div>
      {brandsQ.isPending ? <p className="mt-10 text-sm" style={{ color: "var(--dim)" }}>Loading the brand directory…</p> : (
        <div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((b) => (
            <article key={b.name} className="card-lift rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-2">
                <h2 className="font-display text-[22px] leading-tight" style={{ color: "var(--text)" }}>{b.name}</h2>
                {b.shopCount > 0 || b.ownedCount > 0
                  ? <span className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>IN WEARWISE</span>
                  : <span className="shrink-0 rounded-full border px-2.5 py-1 text-[10px] font-bold" style={{ borderColor: "var(--border)", color: "var(--dim)" }}>DIRECTORY</span>}
              </div>
              <p className="mt-1 text-xs font-bold tracking-[0.14em] uppercase" style={{ color: "var(--dim)" }}>{b.group} · {b.origin}</p>
              <p className="mt-2 text-sm" style={{ color: "var(--text)" }}>{b.knownFor}</p>
              <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>
                {b.ownedCount > 0 ? `You own ${b.ownedCount} piece${b.ownedCount > 1 ? "s" : ""}. ` : ""}
                {b.shopCount > 0 ? `${b.shopCount} product${b.shopCount > 1 ? "s" : ""} in Smart Shop.` : b.ownedCount > 0 ? "In your wardrobe." : "Catalog expanding — ask WearWise to check this brand before you buy."}
              </p>
              {(b.shopCount > 0 || b.ownedCount > 0) ? (
                <button type="button" onClick={() => go(b.shopCount > 0 ? "shop" : "wardrobe")} className="btn-lift mt-3 text-sm font-bold" style={{ color: "var(--accent)" }}>{b.shopCount > 0 ? "Shop this brand →" : "See in wardrobe →"}</button>
              ) : null}
            </article>
          ))}
        </div>
      )}
      {filtered.length === 0 && !brandsQ.isPending ? <p className="mt-10 text-sm" style={{ color: "var(--dim)" }}>No brand matches that search in this group.</p> : null}
    </div>
  );
}

/* ---------------- Snap & Style ---------------- */

const SNAP_SAMPLES = ["Today's college look", "Date night fit", "Festive kurta look", "Streetwear layers"];

function SnapStyle({ userId, go }: { userId: number; go: (v: View) => void }) {
  const qc = useQueryClient();
  void qc;
  const fileRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<"idle" | "scanning" | "done">("idle");
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [applied, setApplied] = useState<Set<string>>(new Set());
  const [swaps, setSwaps] = useState<Map<string, Item>>(new Map());
  const scan = useMutation({ mutationFn: (v: { hint: string; sampleIndex: number }) => api.analyzeOutfitPhoto({ userId, hint: v.hint, sampleIndex: v.sampleIndex }) });

  const start = (name: string, idx: number, url: string | null) => {
    setFileName(name); setPreview(url); setPhase("scanning"); setApplied(new Set()); setSwaps(new Map()); scan.reset();
    setTimeout(() => { scan.mutate({ hint: name, sampleIndex: idx }); setPhase("done"); }, 2100);
  };
  const r = scan.data;
  const displayLook: Item[] = (r?.look ?? []).map((it) => {
    for (const [, v] of swaps) if (v.slot === it.slot) return v;
    return it;
  });
  if (swaps.has("accessory")) {
    const acc = swaps.get("accessory")!;
    if (!displayLook.some((i) => i.slot === "accessory")) displayLook.push(acc);
  }
  if (swaps.has("outerwear")) {
    const layer = swaps.get("outerwear")!;
    if (!displayLook.some((i) => i.slot === "outerwear")) displayLook.push(layer);
  }
  const liveScore = r ? Math.min(99, r.score + applied.size * 3) : 0;

  const applySuggestion = (s: { id: string; slot: string; swapItem: Item | null }) => {
    if (applied.has(s.id)) return;
    setApplied((prev) => new Set(prev).add(s.id));
    if (s.swapItem) setSwaps((prev) => new Map(prev).set(s.slot === "outerwear" ? "outerwear" : s.slot, s.swapItem!));
  };

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Snap &amp; Style</p>
      <h1 className="font-display mt-2 max-w-2xl text-4xl leading-[1.05] font-medium md:text-5xl" style={{ color: "var(--text)" }}>Wearing it already? Get a second opinion.</h1>
      <p className="mt-3 max-w-xl" style={{ color: "var(--dim)" }}>Upload a photo of the outfit you're wearing. WearWise scores it, explains the score, and suggests upgrades from clothes you already own — tap a suggestion and watch the look update.</p>

      {phase === "idle" ? (
        <>
          <div className="mt-8 rounded-3xl border-2 border-dashed p-10 text-center" style={{ borderColor: "var(--border)", background: "var(--surface)" }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) start(f.name, Math.floor(Math.random() * 4), URL.createObjectURL(f)); }}>
            <p className="font-display text-3xl" style={{ color: "var(--text)" }}>Upload your outfit</p>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed" style={{ color: "var(--dim)" }}>A full-length mirror photo in decent light scores best. On a phone, “Take a Photo” opens your camera directly.</p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-lift rounded-full px-7 py-3 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Upload Image</button>
              <button type="button" onClick={() => fileRef.current?.click()} className="btn-lift rounded-full border px-7 py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Take a Photo</button>
            </div>
            <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" aria-label="Upload or take an outfit photo"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f.name, Math.floor(Math.random() * 4), URL.createObjectURL(f)); }} />
          </div>
          <p className="mt-8 text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>No photo handy? Score a sample look</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {SNAP_SAMPLES.map((s, i) => (
              <button key={s} type="button" onClick={() => start(s, i, null)} className="btn-lift rounded-full border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>{s}</button>
            ))}
          </div>
        </>
      ) : (
        <div className="mt-8 grid gap-6 lg:grid-cols-2">
          <div className="relative aspect-[4/5] max-h-[560px] w-full overflow-hidden rounded-3xl border" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
            {preview ? <img src={preview} alt={fileName || "Your outfit"} className="h-full w-full object-cover" />
              : r && r.look[0] ? <ItemVisual item={r.look[0]} />
              : <div className="flex h-full items-center justify-center p-8 text-center"><p className="font-display text-2xl italic" style={{ color: "var(--dim)" }}>{fileName}</p></div>}
            {phase === "scanning" ? <div className="scan-line absolute left-0 h-0.5 w-full" style={{ background: "var(--accent)", boxShadow: "0 0 24px 4px color-mix(in srgb, var(--accent) 65%, transparent)" }} aria-hidden="true" /> : null}
            {phase === "done" && r ? (
              <div className="absolute inset-x-0 bottom-0 p-4" style={{ background: "linear-gradient(to top, rgba(5,5,8,.88), transparent)" }}>
                <p className="text-sm font-bold text-white">Your look, upgraded by tapping suggestions →</p>
                <div className="mt-2 flex gap-2 overflow-x-auto no-scrollbar">
                  {displayLook.map((it) => (
                    <div key={it.id} className="w-16 shrink-0">
                      <div className="aspect-[3/4] overflow-hidden rounded-lg"><ItemVisual item={it} /></div>
                      <p className="mt-1 truncate text-[9px] font-bold tracking-wide text-white/85 uppercase">{SLOT_LABEL[it.slot] ?? it.slot}</p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <div>
            {phase === "scanning" || !r ? (
              <AiSteps steps={r?.steps ?? ["Scanning your outfit photo", "Reading colours & fit", "Scoring against the occasion", "Finding upgrades you already own"]} title="Reading your outfit" />
            ) : (
              <div className="anim-fade-up">
                <div className="flex items-center gap-6">
                  <div className="relative shrink-0" style={{ width: 118, height: 118 }} role="img" aria-label={`Outfit score: ${liveScore} out of 100`}>
                    <svg viewBox="0 0 110 110" width={118} height={118} className="-rotate-90">
                      <circle cx="55" cy="55" r={46} fill="none" stroke="var(--border)" strokeWidth="7" />
                      <circle cx="55" cy="55" r={46} fill="none" stroke="var(--sage)" strokeWidth="7" strokeLinecap="round" strokeDasharray={2 * Math.PI * 46} strokeDashoffset={2 * Math.PI * 46 - (2 * Math.PI * 46 * liveScore) / 100} className="ring-anim" />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                      <span className="font-display text-3xl leading-none" style={{ color: "var(--text)" }}>{liveScore}</span>
                      <span className="mt-1 text-[10px] font-semibold tracking-[0.14em] uppercase" style={{ color: "var(--dim)" }}>/ 100</span>
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 className="font-display text-2xl" style={{ color: "var(--text)" }}>Outfit Score</h2>
                    <div className="mt-3 grid gap-2.5">
                      {r.breakdown.map((b) => (
                        <div key={b.label}>
                          <div className="mb-1 flex items-center justify-between text-xs"><span style={{ color: "var(--dim)" }}>{b.label}</span><span className="font-bold" style={{ color: "var(--text)" }}>{b.score}</span></div>
                          <Bar pct={b.score} />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
                <p className="font-display mt-5 text-xl italic leading-snug" style={{ color: "var(--text)" }}>“{r.analysis}”</p>
                <h3 className="mt-6 text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>AI Suggestions — tap to apply</h3>
                <ul className="mt-3 grid gap-2">
                  {r.suggestions.map((s) => {
                    const done = applied.has(s.id);
                    return (
                      <li key={s.id}>
                        <button type="button" disabled={done} onClick={() => applySuggestion(s)} aria-pressed={done}
                          className="btn-lift flex w-full items-start gap-3 rounded-2xl border px-4 py-3.5 text-left disabled:opacity-70"
                          style={{ borderColor: done ? "var(--sage)" : "var(--border)", background: done ? "color-mix(in srgb, var(--sage) 10%, var(--surface))" : "var(--surface)" }}>
                          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold" style={{ background: done ? "var(--sage)" : "var(--accent)", color: done ? "#0d120a" : "var(--accent-ink)" }}>{done ? "✓" : "✦"}</span>
                          <span>
                            <span className="block text-sm font-semibold leading-relaxed" style={{ color: "var(--text)" }}>{s.text}</span>
                            <span className="mt-0.5 block text-xs" style={{ color: "var(--dim)" }}>{done ? `Applied — score +3. ${s.swapItem ? `Now wearing your ${s.swapItem.name.toLowerCase()}.` : ""}` : s.swapItem ? `Uses your ${s.swapItem.name}` : "A styling principle, applied to this look"}</span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <div className="mt-6 flex flex-wrap gap-2">
                  <button type="button" onClick={() => { setPhase("idle"); setPreview(null); }} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Snap another</button>
                  <button type="button" onClick={() => go("stylist")} className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Style a fresh outfit →</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------------- Pack Smart ---------------- */

function PackSmart({ userId }: { userId: number }) {
  const [destination, setDestination] = useState("Goa");
  const [days, setDays] = useState(4);
  const [tripType, setTripType] = useState("Beach");
  const [phase, setPhase] = useState(false);
  const [showOutfits, setShowOutfits] = useState(false);
  const [planSaved, setPlanSaved] = useState(false);
  const shared = useWearWiseOptional();
  const pack = useMutation({
    mutationFn: () => aiService.generatePackingList(userId, { destination: destination.trim() || "Goa", days, tripType }),
    onSuccess: (d) => { shared?.dispatch(storeActions.hydratePacking(d.plan)); setPlanSaved(true); },
  });
  const build = () => {
    setPhase(true); setShowOutfits(false); setPlanSaved(false); pack.reset();
    setTimeout(() => { setPhase(false); pack.mutate(); }, 1100);
  };
  const r = pack.data?.raw;
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Packing Assistant</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>Pack Smarter.</h1>
      <p className="mt-3 max-w-xl" style={{ color: "var(--dim)" }}>Tell WearWise where and how long — it builds a capsule from clothes you already own, where every piece mixes with every other.</p>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.4fr]">
        <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Trip details">
          <div>
            <label htmlFor="pack-dest" className="mb-1.5 block text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)" }}>Destination</label>
            <input id="pack-dest" {...FIELDS.generatePackingList.destination} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder="Goa"
              className="w-full rounded-xl border px-4 py-3 text-base font-semibold" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
          </div>
          <div className="mt-5">
            <label htmlFor="pack-days" className="mb-1.5 block text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)" }}>Duration — {days} days</label>
            <input id="pack-days" {...FIELDS.generatePackingList.days} type="range" value={days} onChange={(e) => setDays(Number(e.target.value))} className="w-full" aria-valuetext={`${days} days`} />
            <div className="flex justify-between text-[11px]" style={{ color: "var(--faint)" }}><span>Weekend</span><span>A month</span></div>
          </div>
          <div className="mt-5">
            <ChipRow label="Trip type" options={["Beach", "Casual", "Party", "Business", "Wedding / Festive"]} value={tripType} onChange={setTripType} />
          </div>
          <button type="button" disabled={phase || pack.isPending} onClick={build} className="btn-lift mt-6 w-full rounded-full py-3.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
            {phase || pack.isPending ? "Building your capsule…" : "Build My Packing List"}
          </button>
          {phase ? <AiSteps steps={["Reading your wardrobe", "Matching the destination & weather", "Maximising outfit combinations", "Your capsule is ready"]} /> : null}
        </section>

        <section aria-label="Packing list" aria-live="polite">
          {r ? (
            <div className="anim-fade-up">
              <div className="overflow-hidden rounded-3xl border" style={{ borderColor: "var(--border)" }}>
                <div className="p-6" style={{ background: "linear-gradient(140deg, color-mix(in srgb, var(--accent) 16%, var(--surface)), var(--surface))" }}>
                  <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>{destination || "Trip"} · {days} days · {tripType}</p>
                  <p className="font-display mt-2 text-4xl font-medium" style={{ color: "var(--text)" }}>{r.outfitCount} outfits from {r.itemCount} items</p>
                  <p className="mt-2 max-w-lg text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{r.note}</p>
                  {planSaved ? <p className="mt-3 text-xs font-bold" style={{ color: "var(--sage)" }} role="status">✓ Plan saved — {pack.data?.plan.selectedItemIds.length ?? 0} of your own pieces, kept in your WearWise plans.</p> : null}
                </div>
                <div className="grid gap-0 sm:grid-cols-3" style={{ background: "var(--surface)" }}>
                  {r.groups.map((g, gi) => (
                    <div key={g.label} className="p-6" style={{ borderLeft: gi > 0 ? "1px solid var(--border)" : undefined }}>
                      <h3 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>{g.label}</h3>
                      <ul className="mt-3 grid gap-2">
                        {g.entries.map((e, ei) => (
                          <li key={`${g.label}-${ei}`} className="flex items-start gap-2 text-sm" style={{ color: "var(--text)" }}>
                            <span aria-hidden="true" style={{ color: e.owned ? "var(--sage)" : "var(--accent)" }}>{e.owned ? "✓" : "＋"}</span>
                            <span>{e.label}{e.owned ? "" : <span className="block text-[11px]" style={{ color: "var(--faint)" }}>Not in your wardrobe yet</span>}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
              <button type="button" onClick={() => setShowOutfits((s) => !s)} aria-expanded={showOutfits} className="btn-lift mt-5 rounded-full px-6 py-3 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                {showOutfits ? "Hide Outfits" : "Generate Outfits"}
              </button>
              {showOutfits ? (
                <div className="anim-fade-up mt-5 grid gap-4 md:grid-cols-2">
                  {r.outfits.map((o, oi) => (
                    <article key={oi} className="rounded-3xl border p-5" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
                      <div className="flex items-center justify-between">
                        <h4 className="font-semibold" style={{ color: "var(--text)" }}>Day {oi + 1} look</h4>
                        <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{o.matchScore}%</span>
                      </div>
                      <div className="mt-3"><OutfitStrip outfit={o} compact /></div>
                    </article>
                  ))}
                </div>
              ) : null}
            </div>
          ) : !phase ? (
            <div className="flex h-full min-h-64 flex-col items-center justify-center rounded-3xl border border-dashed p-10 text-center" style={{ borderColor: "var(--border)" }}>
              <p className="font-display text-2xl italic" style={{ color: "var(--text)" }}>Your capsule appears here.</p>
              <p className="mt-2 max-w-sm text-sm" style={{ color: "var(--dim)" }}>Goa, 4 days, beach — the defaults on the left — is a good first trip to try.</p>
            </div>
          ) : null}
        </section>
      </div>
    </div>
  );
}

/* ---------------- Wardrobe Analytics (gaps, cost-per-wear, use-again) ---------------- */

function AnalyticsPage({ userId, go }: { userId: number; go: (v: View) => void }) {
  const items = useItems(userId);
  const gapsQ = useQuery({ queryKey: ["gaps", userId], queryFn: () => api.getWardrobeGaps({ userId }) });
  /* The same gaps, in the shared WardrobeGap model from the global
     store — Smart Shop reads this identical list (§9). */
  const shared = useWearWiseOptional();
  const sharedGaps = shared?.state.wardrobeGaps ?? [];
  const [againOffset, setAgainOffset] = useState(0);
  const againQ = useQuery({ queryKey: ["useagain", userId, againOffset], queryFn: () => api.getUseAgain({ userId, offset: againOffset }) });
  const all = items.data?.items ?? [];
  const byCpw = [...all].sort((a, b) => a.costPerWear - b.costPerWear);
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Wardrobe Analytics</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>What your wardrobe is telling you.</h1>

      <AnalyticsSection userId={userId} />

      {/* Gap analysis */}
      <section className="mt-12" aria-label="Wardrobe gap analysis">
        <h2 className="font-display text-3xl font-medium" style={{ color: "var(--text)" }}>What is your wardrobe missing?</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Not random products — the specific pieces whose absence costs you the most outfits, counted against what you already own.</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {(gapsQ.data?.gaps ?? []).map((g, gi) => (
            <article key={g.title} className="card-lift rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex items-start justify-between gap-3">
                <h3 className="font-display text-2xl" style={{ color: "var(--text)" }}>{gi + 1}. {g.title}</h3>
                <div className="shrink-0 text-right">
                  <p className="font-display text-3xl" style={{ color: "var(--accent)" }}>{g.potentialCombos}+</p>
                  <p className="text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Combinations</p>
                </div>
              </div>
              <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{g.reason}</p>
              {(() => { const sg = sharedGaps.find((x) => x.itemType === g.title); return sg ? (
                <p className="mt-2 text-[11px] font-bold tracking-wide uppercase" style={{ color: sg.priority === "High" ? "var(--danger)" : "var(--dim)" }}>
                  {sg.priority} priority · unlocks outfits with {sg.matchingExistingItemIds.length} pieces you own{sg.recommended ? " · top recommendation" : ""}
                </p>
              ) : null; })()}
              <button type="button" onClick={() => go("shop")} className="btn-lift mt-4 rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Find Products →</button>
            </article>
          ))}
          {gapsQ.isPending ? <p className="text-sm" style={{ color: "var(--dim)" }}>Analyzing gaps…</p> : null}
          {gapsQ.data && gapsQ.data.gaps.length === 0 ? <p className="text-sm" style={{ color: "var(--dim)" }}>No major gaps — your wardrobe covers the essentials. Impressive.</p> : null}
        </div>
      </section>

      {/* Cost per wear — full league table */}
      <section className="mt-12" aria-label="Cost per wear">
        <h2 className="font-display text-3xl font-medium" style={{ color: "var(--text)" }}>Cost per wear, ranked.</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Price paid ÷ times worn, in ₹. The top of this list is where your money worked; the bottom is where it sleeps.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {byCpw.slice(0, 6).map((it, ix) => (
            <article key={it.id} className="rounded-2xl border p-5" style={{ background: "var(--surface)", borderColor: ix === 0 ? "var(--sage)" : ix === byCpw.slice(0, 6).length - 1 ? "var(--danger)" : "var(--border)" }}>
              <p className="text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>{it.brand || it.category} · {it.category}</p>
              <h3 className="mt-1 font-semibold leading-tight" style={{ color: "var(--text)" }}>{it.name}</h3>
              <p className="mt-2 text-xs" style={{ color: "var(--dim)" }}>{inr(it.price)} · worn {it.wornCount} times</p>
              <p className="font-display mt-1 text-3xl" style={{ color: ix === 0 ? "var(--sage)" : "var(--text)" }}>{inr(it.costPerWear)} <span className="text-base">/ wear</span></p>
              <p className="mt-2 text-xs italic leading-relaxed" style={{ color: "var(--dim)" }}>
                {ix === 0 ? "“This is one of the most valuable items in your wardrobe.”" : it.wornCount < 5 ? "“Consider finding more ways to wear this before buying another similar piece.”" : "“Solid rotation piece — its cost per wear keeps dropping.”"}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* Use this again */}
      <section className="mt-12" aria-label="Use this again">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="font-display text-3xl font-medium" style={{ color: "var(--text)" }}>Use this again</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Neglected pieces, rescued: three complete ways to wear each one again.</p>
          </div>
          <button type="button" onClick={() => setAgainOffset((o) => o + 2)} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Generate More</button>
        </div>
        <div className="mt-6 grid gap-5">
          {(againQ.data?.entries ?? []).map((e) => (
            <article key={e.item.id} className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }}>
              <div className="flex flex-wrap items-center gap-4">
                <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}><ItemVisual item={e.item} /></div>
                <div>
                  <h3 className="font-display text-2xl" style={{ color: "var(--text)" }}>You haven't worn this in {e.days} days.</h3>
                  <p className="text-sm" style={{ color: "var(--dim)" }}>{e.item.brand ? `${e.item.brand} · ` : ""}{e.item.name} · {inr(e.item.costPerWear)}/wear so far</p>
                </div>
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-3">
                {e.looks.map((l) => (
                  <div key={l.occasion} className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-bold tracking-[0.14em] uppercase" style={{ color: "var(--accent)" }}>{l.occasion}</p>
                      <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{l.outfit.matchScore}%</span>
                    </div>
                    <div className="mt-3"><OutfitStrip outfit={l.outfit} compact /></div>
                  </div>
                ))}
              </div>
            </article>
          ))}
          {againQ.isPending ? <p className="text-sm" style={{ color: "var(--dim)" }}>Finding neglected pieces…</p> : null}
          {againQ.data && againQ.data.entries.length === 0 ? <p className="text-sm" style={{ color: "var(--dim)" }}>Nothing neglected — everything has been worn in the last two weeks.</p> : null}
        </div>
      </section>
    </div>
  );
}

/* ---------------- Unique Edge: Repeat Radar · 7 Ways · Dead Stock · Tomorrow · Colour Season ----------------
   Five features no generic wardrobe app has, all computed from the same
   shared wardrobe rows (plus the wear-log / challenge / tomorrow-plan
   tables) — no separate state, no new design language. */

function PieceSelect({ id, label, pool, value, onChange }: { id: string; label: string; pool: Item[]; value: number | null; onChange: (id: number | null) => void }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>{label}</label>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
        className="w-full rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} aria-label={label}>
        <option value="">— none —</option>
        {pool.map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}
      </select>
    </div>
  );
}

function UniqueEdge({ userId, go, toast }: { userId: number; go: (v: View) => void; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const itemsQ = useItems(userId);
  const all = itemsQ.data?.items ?? [];
  const savedQ = useQuery({ queryKey: ["saved", userId], queryFn: () => api.listSavedOutfits({ userId }) });

  /* ---------- Repeat Radar state ---------- */
  const [topId, setTopId] = useState<number | null>(null);
  const [bottomId, setBottomId] = useState<number | null>(null);
  const [shoesId, setShoesId] = useState<number | null>(null);
  const [audience, setAudience] = useState("");
  const [radarOccasion, setRadarOccasion] = useState("College");
  const [location, setLocation] = useState("");
  const [checkReq, setCheckReq] = useState<{ itemIds: number[]; audience: string } | null>(null);
  const [logMsg, setLogMsg] = useState<string | null>(null);
  useEffect(() => {
    if (!all.length) return;
    const best = (slot: string) => [...all].filter((i) => i.slot === slot).sort((a, b) => b.wornCount - a.wornCount)[0]?.id ?? null;
    setTopId((v) => v ?? best("top") ?? best("ethnic"));
    setBottomId((v) => v ?? best("bottom"));
    setShoesId((v) => v ?? best("shoes"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemsQ.data]);
  const pickedIds = [topId, bottomId, shoesId].filter((n): n is number => n !== null);
  const radarQ = useQuery({
    queryKey: ["radar", userId, checkReq?.itemIds.join(",") ?? "", checkReq?.audience ?? ""],
    queryFn: () => aiService.getRepeatRadar(userId, checkReq ?? undefined),
  });
  const logWear = useMutation({
    mutationFn: () => aiService.logWear(userId, { itemIds: pickedIds, occasion: radarOccasion, audience: audience.trim(), location: location.trim() }),
    onSuccess: (d) => {
      setLogMsg(d.repeat.message);
      setCheckReq(null);
      qc.invalidateQueries({ queryKey: ["radar", userId] });
      qc.invalidateQueries({ queryKey: ["items", userId] });
      toast(d.repeat.isRepeat ? "Logged — and yes, that was a repeat ⚠" : "Wear logged to Repeat Radar ✦");
    },
  });
  const applySavedOutfit = (ids: number[]) => {
    const byId = new Map(all.map((i) => [i.id, i]));
    const chosen = ids.map((id) => byId.get(id)).filter((i): i is Item => Boolean(i));
    setTopId(chosen.find((i) => i.slot === "top" || i.slot === "ethnic")?.id ?? null);
    setBottomId(chosen.find((i) => i.slot === "bottom")?.id ?? null);
    setShoesId(chosen.find((i) => i.slot === "shoes")?.id ?? null);
    setLogMsg(null); setCheckReq(null);
  };

  /* ---------- One Item, 7 Ways + challenge ---------- */
  const [sevenItemId, setSevenItemId] = useState<number | null>(null);
  const sevenQ = useQuery({ queryKey: ["sevenways", userId, sevenItemId], queryFn: () => aiService.getSevenWays(userId, sevenItemId) });
  const challengeQ = useQuery({ queryKey: ["challenge", userId], queryFn: () => aiService.getChallenge(userId) });
  const [challengeMsg, setChallengeMsg] = useState<string | null>(null);
  const startChallenge = useMutation({
    mutationFn: (itemId: number) => aiService.startChallenge(userId, itemId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["challenge", userId] }); setChallengeMsg(null); toast("30-day challenge started — wear it on 7 different days ✦"); },
  });
  const logChallengeWear = useMutation({
    mutationFn: () => aiService.logChallengeWear(userId),
    onSuccess: (d) => {
      setChallengeMsg(d.message);
      qc.invalidateQueries({ queryKey: ["challenge", userId] });
      qc.invalidateQueries({ queryKey: ["items", userId] });
      qc.invalidateQueries({ queryKey: ["sevenways", userId] });
    },
  });
  const challenge = challengeQ.data?.challenge ?? null;
  const sevenItem = sevenQ.data?.item ?? null;

  /* ---------- Dead Stock to Cash ---------- */
  const deadQ = useQuery({ queryKey: ["deadstock", userId], queryFn: () => aiService.getDeadStock(userId) });
  const [decisions, setDecisions] = useState<Set<string>>(new Set());
  const decide = (itemId: number, action: string) => {
    setDecisions((s) => new Set(s).add(`${itemId}`));
    toast(action === "Donate" ? "Marked for donation — space (and karma) unlocked ✦" : action === "Sell" ? "Marked to sell — list it while the style is current ✦" : "Give it one styled week first ✦");
  };

  /* ---------- Tomorrow, Laid Out ---------- */
  const [tomorrowOccasion, setTomorrowOccasion] = useState("College");
  const tomorrowQ = useQuery({ queryKey: ["tomorrow", userId], queryFn: () => aiService.getTomorrowPlan(userId) });
  const setTomorrow = useMutation({
    mutationFn: () => aiService.setTomorrowPlan(userId, tomorrowOccasion),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["tomorrow", userId] }); toast("Tomorrow is laid out — wake up to it ready ✦"); },
  });
  const tomorrow = tomorrowQ.data;
  const tomorrowLabel = tomorrow ? new Date(`${tomorrow.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" }) : "";

  /* ---------- Your Colour Season ---------- */
  const seasonQ = useQuery({ queryKey: ["colourseason", userId], queryFn: () => aiService.getColourSeason(userId) });
  const season = seasonQ.data;

  const sectionCard = { background: "var(--surface)", borderColor: "var(--border)" } as const;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Unique Edge</p>
      <h1 className="font-display mt-2 max-w-2xl text-4xl leading-[1.05] font-medium md:text-5xl" style={{ color: "var(--text)" }}>Five things only your wardrobe knows.</h1>
      <p className="mt-3 max-w-xl" style={{ color: "var(--dim)" }}>Repeat memory, neglected-piece rescue, money sleeping in your closet, tomorrow decided tonight, and the colours that are actually yours — all read from the same {all.length} pieces everything else in WearWise uses.</p>

      {/* ============ 1 · REPEAT RADAR ============ */}
      <section className="mt-10 rounded-3xl border p-6" style={sectionCard} aria-label="Repeat Radar">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>📡 Repeat Radar</p>
            <h2 className="font-display mt-2 text-3xl font-medium" style={{ color: "var(--text)" }}>Who has already seen this outfit?</h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>WearWise remembers what you wore, on which occasion, and who saw it — and warns you before the same people see the same look again inside 30 days.</p>
          </div>
          {(radarQ.data?.trackedWears ?? 0) > 0 ? <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{radarQ.data!.trackedWears} wears tracked</span> : null}
        </div>

        {(radarQ.data?.warnings.length ?? 0) > 0 ? (
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            {radarQ.data!.warnings.map((w) => (
              <article key={`${w.audience}-${w.daysAgo}`} className="rounded-2xl border p-4" style={{ borderColor: w.risk === "High" ? "var(--danger)" : "var(--border)", background: "var(--surface-2)" }}>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{w.audience}</p>
                  <span className="rounded-full px-2.5 py-0.5 text-[10px] font-bold" style={{ background: w.risk === "High" ? "var(--danger)" : "var(--accent)", color: w.risk === "High" ? "#fff" : "var(--accent-ink)" }}>{w.risk.toUpperCase()} REPEAT RISK</span>
                </div>
                <p className="mt-1.5 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{w.message}</p>
                <p className="mt-2 text-[11px] font-semibold" style={{ color: "var(--faint)" }}>{w.itemNames.join(" + ")}</p>
              </article>
            ))}
          </div>
        ) : null}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div>
            <p className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)" }}>Build the outfit</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <PieceSelect id="radar-top" label="Top / Ethnic" pool={all.filter((i) => i.slot === "top" || i.slot === "ethnic")} value={topId} onChange={setTopId} />
              <PieceSelect id="radar-bottom" label="Bottom" pool={all.filter((i) => i.slot === "bottom")} value={bottomId} onChange={setBottomId} />
              <PieceSelect id="radar-shoes" label="Shoes" pool={all.filter((i) => i.slot === "shoes")} value={shoesId} onChange={setShoesId} />
            </div>
            {(savedQ.data?.outfits.length ?? 0) > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="text-[11px] font-bold tracking-wide uppercase self-center" style={{ color: "var(--faint)" }}>Or a saved outfit:</span>
                {savedQ.data!.outfits.slice(0, 4).map((o) => (
                  <button key={o.id} type="button" onClick={() => applySavedOutfit(o.items.map((i) => i.id))} className="btn-lift rounded-full border px-3 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{o.title}</button>
                ))}
              </div>
            ) : null}
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <div>
                <label htmlFor="radar-audience" className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>Who will see it?</label>
                <input id="radar-audience" {...FIELDS.logWear.audience} value={audience} onChange={(e) => setAudience(e.target.value)} placeholder="College friends, Placement panel, Family…"
                  className="w-full rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} list="radar-audiences" />
                <datalist id="radar-audiences">{(radarQ.data?.audiences ?? []).map((a) => <option key={a} value={a} />)}</datalist>
              </div>
              <div>
                <label htmlFor="radar-occasion" className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>Occasion</label>
                <select id="radar-occasion" value={radarOccasion} onChange={(e) => setRadarOccasion(e.target.value)} className="w-full rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} aria-label="Occasion for this wear">
                  {[...OCCASIONS, "Work", "Family Function"].map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </div>
              <div>
                <label htmlFor="radar-location" className="mb-1.5 block text-[10px] font-bold tracking-[0.16em] uppercase" style={{ color: "var(--dim)" }}>Where (optional)</label>
                <input id="radar-location" {...FIELDS.logWear.location} value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Campus, office, café…"
                  className="w-full rounded-xl border px-3.5 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" disabled={pickedIds.length === 0 || !audience.trim()} onClick={() => { setLogMsg(null); setCheckReq({ itemIds: pickedIds, audience: audience.trim() }); }}
                className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Check Repeat Risk</button>
              <button type="button" disabled={pickedIds.length === 0 || logWear.isPending} onClick={() => logWear.mutate()}
                className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{logWear.isPending ? "Logging…" : "I Wore This — Log It"}</button>
            </div>
            {radarQ.data?.check ? (
              <p className="anim-pop mt-4 rounded-2xl border px-4 py-3 text-sm leading-relaxed" role="status"
                style={{ borderColor: radarQ.data.check.isRepeat ? "var(--danger)" : "var(--sage)", background: "var(--surface-2)", color: "var(--text)" }}>{radarQ.data.check.message}</p>
            ) : null}
            {logMsg ? <p className="anim-pop mt-4 rounded-2xl border px-4 py-3 text-sm leading-relaxed" role="status" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}>{logMsg}</p> : null}
          </div>

          <div>
            <p className="text-[11px] font-bold tracking-[0.18em] uppercase" style={{ color: "var(--dim)" }}>Wear history — what, where, to whom</p>
            {radarQ.isPending ? <p className="mt-3 text-sm" style={{ color: "var(--dim)" }}>Reading your wear history…</p> : null}
            {(radarQ.data?.history.length ?? 0) === 0 && !radarQ.isPending ? (
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>No wears logged with context yet. Log your first one on the left — from then on, the radar can warn you before a repeat.</p>
            ) : (
              <ul className="mt-3 grid gap-2.5">
                {radarQ.data!.history.slice(0, 5).map((h) => (
                  <li key={h.id} className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                      <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{h.occasion || "Worn"}{h.audience ? <span style={{ color: "var(--accent)" }}> · to {h.audience}</span> : null}</p>
                      <span className="text-xs" style={{ color: "var(--faint)" }}>{h.daysAgo === 0 ? "Today" : h.daysAgo === 1 ? "Yesterday" : `${h.daysAgo} days ago`}{h.location ? ` · ${h.location}` : ""}</span>
                    </div>
                    <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{h.items.map((i) => i.name).join(" + ")}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {/* ============ 2 · ONE ITEM, 7 WAYS ============ */}
      <section id="seven-ways" className="mt-8 rounded-3xl border p-6" style={sectionCard} aria-label="One Item, 7 Ways">
        <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>✦ One Item, 7 Ways</p>
        <h2 className="font-display mt-2 text-3xl font-medium" style={{ color: "var(--text)" }}>Rescue a neglected piece.</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Pick a piece your wardrobe has forgotten — WearWise builds seven complete outfits around it, then a 30-day challenge turns intention into a streak.</p>

        <div className="mt-5 flex gap-2 overflow-x-auto no-scrollbar pb-1" role="group" aria-label="Choose a neglected piece">
          {(sevenQ.data?.candidates ?? []).map((c) => (
            <button key={c.item.id} type="button" onClick={() => setSevenItemId(c.item.id)} aria-pressed={sevenItem?.id === c.item.id}
              className="btn-lift shrink-0 rounded-full border px-4 py-2 text-xs font-semibold"
              style={sevenItem?.id === c.item.id ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" } : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface-2)" }}>
              {c.item.name} · {c.daysSince}d unworn
            </button>
          ))}
        </div>

        {sevenItem ? (
          <div className="anim-fade-up mt-5">
            <div className="flex flex-wrap items-center gap-4">
              <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}><ItemVisual item={sevenItem} /></div>
              <div>
                <h3 className="font-display text-2xl" style={{ color: "var(--text)" }}>{sevenItem.name}</h3>
                <p className="text-sm" style={{ color: "var(--dim)" }}>{sevenItem.brand ? `${sevenItem.brand} · ` : ""}worn {sevenItem.wornCount} times · {sevenItem.daysSinceWorn === null ? "never worn" : `last worn ${sevenItem.daysSinceWorn} days ago`} · {inr(sevenItem.costPerWear)}/wear so far</p>
              </div>
            </div>
            <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {(sevenQ.data?.outfits ?? []).map((o) => (
                <article key={o.label} className="rounded-2xl border p-4" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold tracking-[0.12em] uppercase" style={{ color: "var(--accent)" }}>{o.label}</p>
                    <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{o.outfit.matchScore}%</span>
                  </div>
                  <div className="mt-3"><OutfitStrip outfit={o.outfit} compact /></div>
                </article>
              ))}
              <article className="flex flex-col justify-between rounded-2xl border p-4" style={{ borderColor: "var(--accent)", background: "color-mix(in srgb, var(--accent) 8%, var(--surface-2))" }}>
                <div>
                  <p className="text-xs font-bold tracking-[0.12em] uppercase" style={{ color: "var(--accent)" }}>The 30-Day Challenge</p>
                  {challenge && challenge.item.id === sevenItem.id ? (
                    <>
                      <p className="font-display mt-2 text-3xl" style={{ color: "var(--text)" }}>{challenge.wearsLogged} / {challenge.targetWears} days</p>
                      <div className="mt-2"><Bar pct={challenge.progressPct} /></div>
                      <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>🔥 Streak {challenge.streak} day{challenge.streak === 1 ? "" : "s"} · {challenge.daysLeft} days left in the challenge</p>
                    </>
                  ) : (
                    <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Wear this piece on 7 different days in the next 30 days. Each day you log grows the streak — and drops its cost-per-wear for real.</p>
                  )}
                </div>
                {challenge && challenge.item.id === sevenItem.id ? (
                  <button type="button" disabled={logChallengeWear.isPending} onClick={() => logChallengeWear.mutate()} className="btn-lift mt-4 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>I Wore It Today</button>
                ) : (
                  <button type="button" disabled={startChallenge.isPending} onClick={() => startChallenge.mutate(sevenItem.id)} className="btn-lift mt-4 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{challenge ? "Switch Challenge to This Piece" : "Start 30-Day Challenge"}</button>
                )}
              </article>
            </div>
            {challengeMsg ? <p className="anim-pop mt-4 text-sm font-semibold" style={{ color: "var(--sage)" }} role="status">✦ {challengeMsg}</p> : null}
            {challenge && challenge.item.id !== sevenItem.id ? (
              <p className="mt-3 text-xs" style={{ color: "var(--faint)" }}>Active challenge right now: {challenge.item.name} — {challenge.wearsLogged}/{challenge.targetWears} days, streak {challenge.streak}. Starting a new one replaces it.</p>
            ) : null}
          </div>
        ) : sevenQ.isPending ? <p className="mt-5 text-sm" style={{ color: "var(--dim)" }}>Finding your most neglected piece…</p> : null}
      </section>

      {/* ============ 3 · DEAD STOCK TO CASH ============ */}
      <section className="mt-8 rounded-3xl border p-6" style={sectionCard} aria-label="Dead Stock to Cash">
        <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>💰 Dead Stock to Cash</p>
        <h2 className="font-display mt-2 text-3xl font-medium" style={{ color: "var(--text)" }}>Money sleeping in your closet.</h2>
        {deadQ.data ? (
          <>
            <div className="mt-5 grid grid-cols-3 gap-3">
              <div className="rounded-2xl border px-3 py-4 text-center" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                <p className="font-display text-2xl md:text-3xl" style={{ color: "var(--text)" }}>{inr(deadQ.data.totalLocked)}</p>
                <p className="mt-1 text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>₹ locked in unworn pieces</p>
              </div>
              <div className="rounded-2xl border px-3 py-4 text-center" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                <p className="font-display text-2xl md:text-3xl" style={{ color: "var(--sage)" }}>{inr(deadQ.data.totalResale)}</p>
                <p className="mt-1 text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>Est. resale recovery</p>
              </div>
              <div className="rounded-2xl border px-3 py-4 text-center" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                <p className="font-display text-2xl md:text-3xl" style={{ color: "var(--text)" }}>{deadQ.data.deadCount} <span className="text-base">dead</span> · {deadQ.data.staleCount} <span className="text-base">stale</span></p>
                <p className="mt-1 text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>90+ days · 30–89 days unworn</p>
              </div>
            </div>
            {deadQ.data.items.length === 0 ? (
              <p className="mt-5 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Nothing has been unworn for 30 days — there is no dead stock in this wardrobe. Genuinely rare.</p>
            ) : (
              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {deadQ.data.items.map((d) => {
                  const decided = decisions.has(`${d.item.id}`);
                  return (
                    <article key={d.item.id} className="rounded-2xl border p-4" style={{ borderColor: d.tier === "Dead stock" ? "var(--danger)" : "var(--border)", background: "var(--surface-2)" }}>
                      <div className="flex gap-3">
                        <div className="h-20 w-16 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: "var(--border)" }}><ItemVisual item={d.item} /></div>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-bold" style={{ background: d.tier === "Dead stock" ? "var(--danger)" : "var(--accent)", color: d.tier === "Dead stock" ? "#fff" : "var(--accent-ink)" }}>{d.tier.toUpperCase()}</span>
                            <span className="text-[11px] font-semibold" style={{ color: "var(--faint)" }}>{d.daysUnworn === null ? "Never worn" : `Unworn ${d.daysUnworn} days`}</span>
                          </div>
                          <h3 className="mt-1 font-semibold leading-tight" style={{ color: "var(--text)" }}>{d.item.name}</h3>
                          <p className="mt-0.5 text-xs" style={{ color: "var(--dim)" }}>Paid {inr(d.item.price)} · worn {d.item.wornCount} times · resale est. <span className="font-bold" style={{ color: "var(--sage)" }}>{inr(d.resaleEstimate)}</span> ({d.resalePct}% of price)</p>
                        </div>
                      </div>
                      <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{d.reason}</p>
                      <div className="mt-3 flex flex-wrap gap-2">
                        {d.action === "Style it first" ? (
                          <button type="button" onClick={() => { setSevenItemId(d.item.id); document.querySelector("#seven-ways")?.scrollIntoView({ behavior: "smooth" }); }} className="btn-lift rounded-full px-4 py-2 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Style It First — 7 Ways</button>
                        ) : (
                          <button type="button" disabled={decided} onClick={() => decide(d.item.id, d.action)} className="btn-lift rounded-full px-4 py-2 text-xs font-bold disabled:opacity-60" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{decided ? `✓ Marked to ${d.action.toLowerCase()}` : d.action === "Sell" ? `Sell — est. ${inr(d.resaleEstimate)}` : "Donate It"}</button>
                        )}
                        <button type="button" onClick={() => go("wardrobe")} className="btn-lift rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>View in Wardrobe</button>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
            <p className="mt-4 text-xs" style={{ color: "var(--faint)" }}>Resale figures are WearWise estimates — a base recovery rate for the category, reduced by wear — to help you decide, not marketplace quotes. Actual prices vary by platform and condition.</p>
          </>
        ) : <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>Counting the money in your closet…</p>}
      </section>

      {/* ============ 4 · TOMORROW, LAID OUT ============ */}
      <section className="mt-8 rounded-3xl border p-6" style={sectionCard} aria-label="Tomorrow, Laid Out">
        <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>🌙 Tomorrow, Laid Out</p>
        <h2 className="font-display mt-2 text-3xl font-medium" style={{ color: "var(--text)" }}>Decide tonight. Wake up dressed.</h2>
        <p className="mt-2 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Pick tomorrow's occasion now — WearWise lays out the outfit from tomorrow's weather and your wardrobe, and saves it so the morning has one less decision.</p>
        {tomorrow ? (
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <span className="rounded-full px-3.5 py-1.5 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{tomorrowLabel}</span>
            <span className="rounded-full border px-3.5 py-1.5 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{tomorrow.weather.temp}°C · {tomorrow.weather.condition}</span>
            <span className="text-[11px]" style={{ color: "var(--faint)" }}>Demo weather reading — a live weather service plugs into this same seam.</span>
          </div>
        ) : null}
        <p className="mt-3 max-w-xl text-sm italic leading-relaxed" style={{ color: "var(--dim)" }}>{tomorrow?.weather.advice}</p>
        <div className="mt-5"><ChipRow label="Tomorrow's occasion" options={OCCASIONS} value={tomorrowOccasion} onChange={setTomorrowOccasion} /></div>
        <button type="button" disabled={setTomorrow.isPending || all.length === 0} onClick={() => setTomorrow.mutate()}
          className="btn-lift mt-5 rounded-full px-6 py-3 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
          {setTomorrow.isPending ? "Laying it out…" : tomorrow?.plan ? "Re-Lay Tomorrow's Outfit" : "Lay Out Tomorrow's Outfit"}
        </button>
        {tomorrow?.plan ? (
          <div className="anim-fade-up mt-6 border-t pt-6" style={{ borderColor: "var(--border)" }} aria-live="polite">
            <div className="flex flex-wrap items-center gap-3">
              <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--sage)", color: "#0d120a" }}>✓ LAID OUT FOR {tomorrow.plan.occasion.toUpperCase()}</span>
              <span className="rounded-full px-3 py-1 text-xs font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{tomorrow.plan.outfit.matchScore}% Match</span>
            </div>
            <div className="mt-4"><OutfitStrip outfit={tomorrow.plan.outfit} /></div>
            <p className="mt-3 max-w-xl text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{tomorrow.plan.note}</p>
          </div>
        ) : !tomorrowQ.isPending ? (
          <p className="mt-5 text-sm" style={{ color: "var(--dim)" }}>Nothing laid out yet — tonight is the moment.</p>
        ) : null}
      </section>

      {/* ============ 5 · YOUR COLOUR SEASON ============ */}
      <section className="mt-8 rounded-3xl border p-6" style={sectionCard} aria-label="Your Colour Season">
        <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>🎨 Your Colour Season</p>
        {season ? (
          <div className="anim-fade-up">
            <div className="flex flex-wrap items-center gap-6">
              <ScoreRing score={season.confidence} size={112} label="Confidence" />
              <div>
                <h2 className="font-display text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>{season.season}</h2>
                <p className="mt-1 max-w-md text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{season.tagline}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{season.undertone} undertone</span>
                  <span className="rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{season.depth} depth</span>
                </div>
              </div>
            </div>

            <h3 className="mt-7 text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Your palette — from your wardrobe</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {season.palette.map((c) => (
                <article key={c.name} className="flex gap-3 rounded-2xl border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <span className="h-11 w-11 shrink-0 rounded-full border" style={{ background: c.hex, borderColor: "var(--border)" }} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{c.name} {c.owned ? <span className="ml-1 rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: "color-mix(in srgb, var(--sage) 22%, transparent)", color: "var(--sage)" }}>YOU OWN IT</span> : <span className="ml-1 rounded-full px-2 py-0.5 text-[9px] font-bold" style={{ background: "color-mix(in srgb, var(--accent) 20%, transparent)", color: "var(--accent)" }}>TRY NEXT</span>}</p>
                    <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{c.note}</p>
                  </div>
                </article>
              ))}
            </div>

            <h3 className="mt-7 text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--danger)" }}>Colours to go easy on</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {season.avoid.map((c) => (
                <article key={c.name} className="flex gap-3 rounded-2xl border p-3.5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <span className="h-11 w-11 shrink-0 rounded-full border" style={{ background: c.hex, borderColor: "var(--border)" }} aria-hidden="true" />
                  <div>
                    <p className="text-sm font-bold" style={{ color: "var(--text)" }}>{c.name}{c.owned ? <span className="ml-1 text-[10px] font-bold" style={{ color: "var(--danger)" }}>· IN YOUR WARDROBE</span> : null}</p>
                    <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{c.reason}</p>
                  </div>
                </article>
              ))}
            </div>

            <div className="mt-7 rounded-2xl border p-5" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
              <h3 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>How WearWise read your season</h3>
              <ul className="mt-3 grid gap-2">
                {season.guidance.map((g) => <li key={g} className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{g}</li>)}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                {season.ownedColors.slice(0, 6).map((c) => (
                  <span key={c.name} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                    <span className="h-3.5 w-3.5 rounded-full border" style={{ background: c.hex, borderColor: "var(--border)" }} aria-hidden="true" />{c.name} · {c.wears} wears
                  </span>
                ))}
              </div>
              <button type="button" onClick={() => go("profile")} className="btn-lift mt-4 rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>See it beside your Style DNA →</button>
            </div>
          </div>
        ) : <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>Reading the colours you actually wear…</p>}
      </section>
    </div>
  );
}

/* ---------------- Ask WearWise (AI command center) ---------------- */

const ASK_SUGGESTIONS = ["What should I wear today?", "Do I need another black shirt?", "What should I pack for Goa?", "How can I style my beige trousers?", "Should I buy this?", "What is missing from my wardrobe?"];

/* ------------------------------------------------------------------ */
/* Intelligence — the unified WearWise Intelligence Layer (§1–§26).    */
/* One hub where the engines become visible: context, style profile,   */
/* preference weights, AI memory, confidence, extended health, ROI,    */
/* insight feed, style evolution, AI evaluation, smart notifications,  */
/* 5-minute onboarding progress, demo reset and data control. Every    */
/* number here comes from getIntelligence / getWardrobeROI over the    */
/* user's real rows — nothing on this page is decorative.              */
/* ------------------------------------------------------------------ */

function WeightBars({ weights, emptyText }: { weights: Record<string, number>; emptyText: string }) {
  const entries = Object.entries(weights).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!entries.length) return <p className="text-sm" style={{ color: "var(--dim)" }}>{emptyText}</p>;
  return (
    <div className="grid gap-2.5">
      {entries.map(([k, v]) => (
        <div key={k}>
          <div className="mb-1 flex justify-between text-xs"><span className="font-semibold capitalize" style={{ color: "var(--text)" }}>{k}</span><span style={{ color: "var(--dim)" }}>{v.toFixed(2)}</span></div>
          <Bar pct={Math.round(v * 100)} />
        </div>
      ))}
    </div>
  );
}

function Intelligence({ userId, go, toast }: { userId: number; go: (v: View) => void; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const intel = useQuery({ queryKey: ["intelligence", userId], queryFn: () => aiService.getIntelligence(userId) });
  const roi = useQuery({ queryKey: ["wardrobe-roi", userId], queryFn: () => aiService.getWardrobeROI(userId) });
  const insights = useInsights(userId);
  const [showAllRoi, setShowAllRoi] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean>>(() => {
    try { return JSON.parse(safeStore.get("ww-notif-prefs") ?? "{}") as Record<string, boolean>; } catch { return {}; }
  });
  const toggleNotif = (id: string) => {
    setNotifPrefs((p) => {
      const next = { ...p, [id]: !(p[id] ?? true) };
      safeStore.set("ww-notif-prefs", JSON.stringify(next));
      return next;
    });
  };
  const downloadExport = async () => {
    const res = await aiService.exportMyData(userId);
    const blob = new Blob([res.bundle], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "wearwise-my-data.json"; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${res.itemCount} wardrobe items + outfits, analyses & feedback ✦`);
  };
  const resetDemo = useMutation({
    mutationFn: () => aiService.resetDemoWardrobe(userId),
    onSuccess: (d) => { qc.invalidateQueries(); toast(`Demo reset — ${d.count} pieces restored to their initial state ✦`); },
  });
  const deleteData = useMutation({
    mutationFn: () => aiService.deleteMyData(userId),
    onSuccess: (d) => { setConfirmDelete(false); qc.invalidateQueries(); toast(`Deleted ${d.deletedItems} wardrobe items and all related data. Use Reset Demo to start again.`); },
  });
  const [confirmClear, setConfirmClear] = useState(false);
  const clearMemory = useMutation({
    mutationFn: () => aiService.clearAiMemory(userId),
    onSuccess: (d) => { setConfirmClear(false); qc.invalidateQueries(); toast(d.cleared > 0 ? `AI memory cleared — ${d.cleared} learning signals removed. WearWise will relearn from your next ratings.` : "AI memory is already empty — no learning signals to clear."); },
  });

  const d = intel.data;
  const roiRows = showAllRoi ? (roi.data?.items ?? []) : (roi.data?.items ?? []).slice(0, 8);
  const steps: Array<{ label: string; done: boolean; hint: string; target: View }> = d ? [
    { label: "Tell us your style — Style DNA generated", done: d.context.itemCount > 0, hint: "Derived from your wardrobe", target: "profile" },
    { label: "Add 5–10 clothes", done: d.context.itemCount >= 5, hint: `${d.context.itemCount} pieces so far`, target: "add" },
    { label: "AI analyzes your wardrobe", done: d.context.itemCount > 0, hint: `Health ${d.health.score}/100 · Confidence ${d.confidence}%`, target: "analytics" },
    { label: "Generate your first outfit", done: d.evaluation.outfitsSaved > 0, hint: d.evaluation.outfitsSaved > 0 ? `${d.evaluation.outfitsSaved} saved` : "Try the AI Stylist", target: "stylist" },
    { label: "Give feedback — WearWise learns", done: d.context.feedbackCount > 0, hint: `${d.context.feedbackCount} signals so far`, target: "stylist" },
    { label: "Run a Buy / Skip verdict", done: d.evaluation.buyAnalyses > 0, hint: d.evaluation.buyAnalyses > 0 ? `${d.evaluation.buyAnalyses} analysed` : "Before your next purchase", target: "buy" },
  ] : [];
  const stepsDone = steps.filter((s) => s.done).length;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>WearWise Intelligence</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>One brain behind every recommendation.</h1>
      <p className="mt-3 max-w-2xl leading-relaxed" style={{ color: "var(--dim)" }}>
        Context, Style, Preference, Scoring, Confidence and Explanation engines — shared by the Stylist, Buy/Skip, Smart Shop, Packing and Ask WearWise, and all computed from your {d?.context.itemCount ?? 0} pieces and {d?.context.feedbackCount ?? 0} learning signals.
      </p>
      {intel.isPending ? <p className="mt-8 text-sm" style={{ color: "var(--dim)" }}>Reading your intelligence profile…</p> : null}
      {intel.isError ? <p className="mt-8 text-sm" style={{ color: "var(--danger)" }}>The intelligence layer couldn't load — pull to retry from any other tab and come back.</p> : null}

      {d ? (
        <>
          {/* Confidence + health headline */}
          <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_1.6fr]">
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Wardrobe health and confidence">
              <div className="flex items-center gap-5">
                <ScoreRing score={d.health.score} size={118} label="Health" />
                <div>
                  <p className="text-[11px] font-bold tracking-[0.2em] uppercase" style={{ color: "var(--dim)" }}>AI Confidence</p>
                  <p className="font-display mt-1 text-4xl" style={{ color: "var(--text)" }}>{d.confidence}%</p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{confidenceLabel(d.confidence)}</p>
                </div>
              </div>
              <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>{d.health.explanation}</p>
              <p className="mt-3 text-xs" style={{ color: "var(--faint)" }}>Archetype: <span className="font-semibold" style={{ color: "var(--text)" }}>{d.styleProfile.archetype}</span> · {d.styleProfile.formalityPreference}</p>
            </section>
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Health breakdown">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Wardrobe Health — how the score is calculated</h2>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {d.health.dimensions.map((dim) => (
                  <div key={dim.label}>
                    <div className="mb-1 flex justify-between text-xs"><span style={{ color: "var(--text)" }}>{dim.label}</span><span className="font-bold" style={{ color: "var(--text)" }}>{dim.score}</span></div>
                    <Bar pct={dim.score} />
                  </div>
                ))}
              </div>
              <div className="mt-5 grid grid-cols-2 gap-3 text-center sm:grid-cols-4">
                {[
                  [`${inr(d.userAnalytics.totalWardrobeValue)}`, "Wardrobe value"],
                  [`${inr(d.userAnalytics.averageCostPerWear)}`, "Avg cost / wear"],
                  [`${d.userAnalytics.mostWornCategory}`, "Most worn category"],
                  [`${d.userAnalytics.favoriteColor}`, "Favourite colour"],
                ].map(([v, l]) => (
                  <div key={l} className="rounded-2xl border px-2 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                    <p className="truncate text-sm font-bold" style={{ color: "var(--text)" }}>{v}</p>
                    <p className="mt-0.5 text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>{l}</p>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* AI Memory + Preference weights */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="AI memory">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>✦ AI Memory — what WearWise remembers about your taste</h2>
              <dl className="mt-4 grid gap-3 text-sm">
                {([
                  ["Favourite colours", d.memory.favoriteColors.join(", ") || "—"],
                  ["Favourite fits", d.memory.favoriteFits.join(", ") || "—"],
                  ["Favourite styles", d.memory.favoriteStyles.join(", ") || "—"],
                  ["Favourite occasions", d.memory.favoriteOccasions.join(", ") || "—"],
                  ["Preferred footwear", d.memory.preferredFootwear],
                  ["Preferred brands", d.memory.preferredBrands.join(", ") || "—"],
                  ["Budget pattern", d.memory.budgetRange],
                  ["Traditional / western", d.memory.traditionalWestern],
                  ["Layering", d.memory.layeringPreference],
                ] as Array<[string, string]>).map(([k, v]) => (
                  <div key={k} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-b pb-2" style={{ borderColor: "var(--border)" }}>
                    <dt style={{ color: "var(--dim)" }}>{k}</dt><dd className="font-semibold text-right" style={{ color: "var(--text)" }}>{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--faint)" }}>Fashion preferences only — no personal data beyond your wardrobe and ratings. This memory feeds outfit generation, shopping, Buy/Skip, packing and Ask WearWise.</p>
            </section>
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Preference weights">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Preference Engine — learned weights</h2>
              <div className="mt-4 grid gap-5 sm:grid-cols-2">
                <div><p className="mb-2 text-xs font-bold" style={{ color: "var(--text)" }}>Preferred colours</p><WeightBars weights={d.preferences.preferredColors} emptyText="Wear a few pieces and colour weights appear." /></div>
                <div><p className="mb-2 text-xs font-bold" style={{ color: "var(--text)" }}>Preferred styles</p><WeightBars weights={d.preferences.preferredStyles} emptyText="Rate outfits in the Stylist to teach style weights." /></div>
                <div><p className="mb-2 text-xs font-bold" style={{ color: "var(--text)" }}>Preferred fits</p><WeightBars weights={d.preferences.preferredFits} emptyText="Fits are weighted by what you wear most." /></div>
                <div><p className="mb-2 text-xs font-bold" style={{ color: "var(--text)" }}>Avoided styles</p><WeightBars weights={d.preferences.avoidedStyles} emptyText="Nothing avoided yet — “Not my style” ratings land here." /></div>
              </div>
              <p className="mt-4 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>These weights bias the outfit engine's picks directly — loved styles score higher, avoided styles lower. {d.preferences.signalCount} signals learned so far.</p>
            </section>
          </div>

          {/* Wardrobe ROI */}
          <section className="mt-6 rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Wardrobe ROI">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-2xl font-medium" style={{ color: "var(--text)" }}>Wardrobe ROI — what each piece earns</h2>
              <span className="text-sm" style={{ color: "var(--dim)" }}>Average ROI <span className="font-bold" style={{ color: "var(--accent)" }}>{roi.data?.averageRoi ?? 0}/100</span></span>
            </div>
            <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>ROI blends versatility, real outfit pairings, wear frequency and cost-per-wear, discounted by duplicate risk. For a purchase, Buy/Skip shows the same score before you spend.</p>
            <ul className="mt-4 grid gap-2.5">
              {roiRows.map((r) => (
                <li key={r.itemId} className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                    <span className="text-sm font-semibold" style={{ color: "var(--text)" }}>{r.brand ? `${r.brand} · ` : ""}{r.name}</span>
                    <span className="text-sm font-bold" style={{ color: r.roiScore >= 70 ? "var(--sage)" : r.roiScore >= 45 ? "var(--accent)" : "var(--danger)" }}>ROI {r.roiScore}/100</span>
                  </div>
                  <div className="mt-2"><Bar pct={r.roiScore} /></div>
                  <p className="mt-2 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>
                    {r.potentialOutfits} outfit pairings · pairs with {r.compatibleItems} pieces · {r.compatibleOccasions} occasions · {r.wearFrequency} wears · {inr(r.price)} paid, {inr(r.costPerWear)}/wear · duplicate risk {r.duplicateRisk}%
                  </p>
                  <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--faint)" }}>{r.gapContribution}</p>
                </li>
              ))}
            </ul>
            {(roi.data?.items.length ?? 0) > 8 ? (
              <button type="button" onClick={() => setShowAllRoi((s) => !s)} className="btn-lift mt-4 rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{showAllRoi ? "Show top 8 only" : `Show all ${roi.data!.items.length} pieces`}</button>
            ) : null}
          </section>

          {/* Insight feed + Style evolution */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="AI insight feed">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>💡 AI Insight Feed</h2>
              <ul className="mt-4 grid gap-2.5">
                {(insights.data?.feed ?? []).map((line) => (
                  <li key={line} className="rounded-2xl border px-4 py-3 text-sm leading-relaxed" style={{ borderColor: "var(--border)", background: "var(--surface-2)", color: "var(--text)" }}>{line}</li>
                ))}
                {(insights.data?.feed.length ?? 0) === 0 ? <li className="text-sm" style={{ color: "var(--dim)" }}>Insights appear as your wardrobe data grows.</li> : null}
              </ul>
              {insights.data?.opportunity ? <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--dim)" }}><span className="font-bold" style={{ color: "var(--text)" }}>Biggest opportunity: </span>{insights.data.opportunity}</p> : null}
            </section>
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Style evolution">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Style Evolution</h2>
              {d.evolution.length === 0 ? (
                <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>No dated feedback yet. Rate outfits in the Stylist and your taste's month-by-month drift appears here — built only from real signals, never backfilled.</p>
              ) : (
                <ol className="mt-4 grid gap-0">
                  {d.evolution.map((p, i) => (
                    <li key={p.month} className="flex gap-3">
                      <div className="flex flex-col items-center" aria-hidden="true">
                        <span className="mt-1 h-3 w-3 rounded-full" style={{ background: "var(--accent)" }} />
                        {i < d.evolution.length - 1 ? <span className="w-px flex-1" style={{ background: "var(--border)" }} /> : null}
                      </div>
                      <div className="pb-5">
                        <p className="text-xs font-bold tracking-wide uppercase" style={{ color: "var(--faint)" }}>{p.month}</p>
                        <p className="font-display text-xl" style={{ color: "var(--text)" }}>{p.dominantStyle}</p>
                        <p className="text-xs" style={{ color: "var(--dim)" }}>{p.signals} learning signal{p.signals === 1 ? "" : "s"} that month</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
              <div className="border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <p className="text-xs font-bold tracking-wide uppercase" style={{ color: "var(--faint)" }}>Most used piece</p>
                <p className="mt-1 text-sm font-semibold" style={{ color: "var(--text)" }}>{d.userAnalytics.mostUsedPiece} · least worn category: {d.userAnalytics.leastWornCategory} · {d.userAnalytics.unusedItems} under-worn pieces</p>
              </div>
            </section>
          </div>

          {/* AI Evaluation + notifications */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="AI evaluation dashboard">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>AI Evaluation — is the intelligence working?</h2>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                {[
                  [`${d.evaluation.totalSignals}`, "Total signals"],
                  [`${d.evaluation.accepted}`, "Accepted"],
                  [`${d.evaluation.rejected}`, "Rejected"],
                  [`${d.evaluation.loveRate ?? "—"}${d.evaluation.loveRate !== null ? "%" : ""}`, "Love rate"],
                  [`${d.evaluation.dislikeRate ?? "—"}${d.evaluation.dislikeRate !== null ? "%" : ""}`, "Dislike rate"],
                  [`${d.confidence}%`, "Avg confidence"],
                ].map(([v, l]) => (
                  <div key={l} className="rounded-2xl border px-2 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                    <p className="font-display text-2xl" style={{ color: "var(--text)" }}>{v}</p>
                    <p className="mt-0.5 text-[10px] font-bold tracking-wide uppercase" style={{ color: "var(--dim)" }}>{l}</p>
                  </div>
                ))}
              </div>
              <ul className="mt-4 grid gap-1.5 text-sm" style={{ color: "var(--dim)" }}>
                {d.usageCounts.map((u) => <li key={u.label} className="flex justify-between"><span>{u.label}</span><span className="font-bold" style={{ color: "var(--text)" }}>{u.count}</span></li>)}
              </ul>
              <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--faint)" }}>Top performing feature: <span className="font-semibold" style={{ color: "var(--text)" }}>{d.evaluation.topFeature}</span> · least used: {d.evaluation.weakestFeature}. Rates show “—” until enough ratings exist — no invented accuracy.</p>
            </section>
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Smart notifications">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Smart Notifications — useful, never spammy</h2>
              <ul className="mt-4 grid gap-2.5">
                {d.notifications.map((n) => {
                  const on = notifPrefs[n.id] ?? true;
                  return (
                    <li key={n.id} className="rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)", opacity: on ? 1 : 0.55 }}>
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{n.icon} {n.title}</p>
                          <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--dim)" }}>{n.body}</p>
                        </div>
                        <button type="button" role="switch" aria-checked={on} aria-label={`${n.title} notifications`} onClick={() => toggleNotif(n.id)}
                          className="btn-lift mt-0.5 h-6 w-11 shrink-0 rounded-full p-0.5" style={{ background: on ? "var(--accent)" : "var(--border)" }}>
                          <span className="block h-5 w-5 rounded-full bg-white shadow" style={{ transform: on ? "translateX(20px)" : "translateX(0)", transition: "transform .25s" }} />
                        </button>
                      </div>
                      {on ? <button type="button" onClick={() => go(n.goto as View)} className="btn-lift mt-2 text-xs font-bold underline underline-offset-2" style={{ color: "var(--accent)" }}>Open →</button> : null}
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs" style={{ color: "var(--faint)" }}>Preferences save on this device. Notifications are computed from your wardrobe each visit — nothing is pushed or scheduled behind your back.</p>
            </section>
          </div>

          {/* Onboarding + demo/data */}
          <div className="mt-6 grid gap-6 lg:grid-cols-2">
            <section className="rounded-3xl border p-6" style={{ background: "linear-gradient(140deg, var(--surface), var(--surface-2))", borderColor: "var(--border)" }} aria-label="Five minute onboarding">
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>⏱ Your first 5 minutes</h2>
                <span className="text-xs font-bold" style={{ color: "var(--text)" }}>{stepsDone}/{steps.length} done</span>
              </div>
              <div className="mt-3"><Bar pct={Math.round((stepsDone / Math.max(steps.length, 1)) * 100)} /></div>
              <ol className="mt-4 grid gap-2.5">
                {steps.map((s, i) => (
                  <li key={s.label} className="flex items-center justify-between gap-3 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface)" }}>
                    <div className="flex items-center gap-3">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold" style={s.done ? { background: "var(--sage)", color: "#0d120a" } : { background: "var(--surface-2)", color: "var(--dim)", border: "1px solid var(--border)" }}>{s.done ? "✓" : i + 1}</span>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: "var(--text)" }}>{s.label}</p>
                        <p className="text-xs" style={{ color: "var(--dim)" }}>{s.hint}</p>
                      </div>
                    </div>
                    {!s.done ? <button type="button" onClick={() => go(s.target)} className="btn-lift shrink-0 rounded-full border px-3 py-1.5 text-[11px] font-bold" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>Start →</button> : null}
                  </li>
                ))}
              </ol>
            </section>
            <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Demo mode and data control">
              <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Demo Mode & Your Data</h2>
              <p className="mt-3 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Your account runs on the real branded demo wardrobe. Reset returns it to its exact initial state — pieces, wear counts and demo wear history — wiping anything you added or changed.</p>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" disabled={resetDemo.isPending} onClick={() => resetDemo.mutate()} className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{resetDemo.isPending ? "Resetting…" : "↺ Reset Demo"}</button>
                <button type="button" onClick={() => void downloadExport()} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>⬇ Export My Data (JSON)</button>
              </div>
              <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
                <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Clear AI Memory removes only what WearWise has learned from your ratings — preference weights, the learned Style DNA line and Style Evolution reset, and future picks stop leaning on old feedback. Your wardrobe, outfits and analyses stay untouched.</p>
                {!confirmClear ? (
                  <button type="button" onClick={() => setConfirmClear(true)} className="btn-lift mt-3 rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Clear AI Memory…</button>
                ) : (
                  <div className="anim-pop mt-3 rounded-2xl border p-4" style={{ borderColor: "var(--accent)", background: "var(--surface-2)" }} role="alertdialog" aria-label="Confirm clear AI memory">
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>Clear all {d?.context.feedbackCount ?? 0} learning signals? Preference weights and Style Evolution will rebuild from your future ratings. This cannot be undone.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={clearMemory.isPending} onClick={() => clearMemory.mutate()} className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>{clearMemory.isPending ? "Clearing…" : "Yes, clear AI memory"}</button>
                      <button type="button" onClick={() => setConfirmClear(false)} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Keep my memory</button>
                    </div>
                  </div>
                )}
              </div>
              <div className="mt-5 border-t pt-4" style={{ borderColor: "var(--border)" }}>
                {!confirmDelete ? (
                  <button type="button" onClick={() => setConfirmDelete(true)} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--danger)" }}>Delete My Data…</button>
                ) : (
                  <div className="anim-pop rounded-2xl border p-4" style={{ borderColor: "var(--danger)", background: "var(--surface-2)" }} role="alertdialog" aria-label="Confirm delete my data">
                    <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>Permanently delete your wardrobe, saved outfits, analyses, feedback and wear history? Your account stays, so you can Reset Demo or start fresh. This cannot be undone.</p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" disabled={deleteData.isPending} onClick={() => deleteData.mutate()} className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--danger)", color: "#fff" }}>{deleteData.isPending ? "Deleting…" : "Yes, delete everything"}</button>
                      <button type="button" onClick={() => setConfirmDelete(false)} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Keep my data</button>
                    </div>
                  </div>
                )}
                <p className="mt-3 text-xs leading-relaxed" style={{ color: "var(--faint)" }}>Privacy: sign-in is a real email + password account (PBKDF2-hashed server-side) with server sessions — every action is validated and checked against your session, so your rows can't be reached by guessing an account id. The one-tap demo account stays passwordless and shared. No API keys exist in the client.</p>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}

function AskWearWise({ userId, go, toast }: { userId: number; go: (v: View) => void; toast: (m: string) => void }) {
  void toast;
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [askError, setAskError] = useState<string | null>(null);
  const [seed, setSeed] = useState(0);
  const [thread, setThread] = useState<Array<{ role: "user" | "ai"; text: string }>>([]);
  const ask = useMutation({
    mutationFn: (q: string) => api.askWearWise({ userId, question: q, seed }),
    onSuccess: (d, q) => setThread((t) => [...t, { role: "user", text: q }, { role: "ai", text: d.answer }]),
  });
  const send = (q: string) => {
    const clean = q.trim();
    if (!clean) { setAskError("Type a question first — anything about your wardrobe."); return; }
    if (ask.isPending) return;
    setAskError(null);
    setSeed((s) => s + 1);
    setInput("");
    ask.mutate(clean);
  };
  return (
    <>
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label="Ask WearWise — AI assistant"
        className="btn-lift fixed right-4 bottom-24 z-[65] flex items-center gap-2 rounded-full px-5 py-3.5 text-sm font-bold shadow-2xl md:right-6 md:bottom-6"
        style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
        <span aria-hidden="true">✦</span> Ask WearWise
      </button>
      {open ? (
        <div className="anim-pop fixed right-4 bottom-40 z-[65] flex max-h-[70dvh] w-[min(92vw,380px)] flex-col overflow-hidden rounded-3xl border shadow-2xl md:right-6 md:bottom-24" style={{ background: "var(--surface)", borderColor: "var(--border)" }} role="dialog" aria-label="Ask WearWise">
          <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--border)" }}>
            <div>
              <p className="font-display text-xl leading-none" style={{ color: "var(--text)" }}>Ask WearWise</p>
              <p className="mt-1 text-[11px]" style={{ color: "var(--dim)" }}>Your wardrobe, answered — from your real pieces.</p>
            </div>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close assistant" className="btn-lift flex h-9 w-9 items-center justify-center rounded-full border" style={{ borderColor: "var(--border)", color: "var(--text)" }}>✕</button>
          </div>
          <div className="grid flex-1 gap-3 overflow-y-auto px-5 py-4" aria-live="polite">
            {thread.length === 0 ? <p className="text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Ask me what to wear, what to pack, or whether that purchase is a duplicate — I answer from the {`wardrobe you actually own`}.</p> : null}
            {thread.map((m, i) => (
              <div key={i} className={m.role === "user" ? "justify-self-end" : "justify-self-start"} style={{ maxWidth: "92%" }}>
                <div className="rounded-2xl px-4 py-3 text-sm leading-relaxed" style={m.role === "user" ? { background: "var(--accent)", color: "var(--accent-ink)", borderBottomRightRadius: 4 } : { background: "var(--surface-2)", color: "var(--text)", borderBottomLeftRadius: 4 }}>{m.text}</div>
              </div>
            ))}
            {ask.isPending ? <p className="text-sm" style={{ color: "var(--dim)" }}>Thinking through your wardrobe…</p> : null}
            {ask.data?.outfit && ask.data.outfit.items.length ? (
              <div className="rounded-2xl border p-3" style={{ borderColor: "var(--border)" }}>
                <OutfitStrip outfit={ask.data.outfit} compact />
              </div>
            ) : null}
            {ask.data?.goto ? (
              <button type="button" onClick={() => { const g = ask.data!.goto as View; setOpen(false); go(g); }} className="btn-lift justify-self-start rounded-full border px-4 py-2 text-xs font-bold" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
                Open {ask.data.goto === "pack" ? "Pack Smart" : ask.data.goto === "analytics" ? "Wardrobe Analytics" : ask.data.goto === "buy" ? "Buy-or-Skip" : ask.data.goto === "edge" ? "Unique Edge" : "AI Stylist"} →
              </button>
            ) : null}
          </div>
          <div className="border-t px-4 pt-3" style={{ borderColor: "var(--border)" }}>
            <div className="flex flex-wrap gap-1.5">
              {ASK_SUGGESTIONS.map((s) => (
                <button key={s} type="button" disabled={ask.isPending} onClick={() => send(s)} className="btn-lift rounded-full border px-3 py-1.5 text-[11px] font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{s}</button>
              ))}
            </div>
            <form className="flex gap-2 py-3" onSubmit={(e) => { e.preventDefault(); send(input); }}>
              <label htmlFor="ask-input" className="sr-only">Ask WearWise a question</label>
              <input id="ask-input" {...FIELDS.askWearWise.question} value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your wardrobe…"
                className="min-w-0 flex-1 rounded-full border px-4 py-2.5 text-sm" style={{ background: "var(--surface-2)", borderColor: "var(--border)", color: "var(--text)" }} />
              <button type="submit" disabled={ask.isPending} className="btn-lift shrink-0 rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Ask</button>
            </form>
            {askError ? <p className="pb-3 text-xs font-semibold" style={{ color: "var(--danger)" }} role="alert">{askError}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}

/* ---------------- Profile / Style DNA ---------------- */

const FEEDBACK_KIND_LABEL: Record<string, string> = {
  love: "❤️ Loved it", good: "👍 Liked it", liked: "👍 Liked it", unsure: "😐 Neutral", not: "👎 Not my style",
  worn: "👕 Wore an outfit", saved: "🔖 Saved an outfit",
};

function ProfileDataControls({ userId, toast }: { userId: number; toast: (m: string) => void }) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const resetDemo = useMutation({
    mutationFn: () => aiService.resetDemoWardrobe(userId),
    onSuccess: (d) => { qc.invalidateQueries(); toast(`Demo reset — ${d.count} pieces restored ✦`); },
  });
  const deleteData = useMutation({
    mutationFn: () => aiService.deleteMyData(userId),
    onSuccess: (d) => { setConfirm(false); qc.invalidateQueries(); toast(`Deleted ${d.deletedItems} wardrobe items and all related data.`); },
  });
  const downloadExport = async () => {
    const res = await aiService.exportMyData(userId);
    const blob = new Blob([res.bundle], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "wearwise-my-data.json"; a.click();
    URL.revokeObjectURL(url);
    toast(`Exported ${res.itemCount} wardrobe items + outfits, analyses & feedback ✦`);
  };
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => void downloadExport()} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>⬇ Export My Data (JSON)</button>
        <button type="button" disabled={resetDemo.isPending} onClick={() => resetDemo.mutate()} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold disabled:opacity-50" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{resetDemo.isPending ? "Resetting…" : "↺ Reset Demo"}</button>
        {!confirm ? (
          <button type="button" onClick={() => setConfirm(true)} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--danger)" }}>Delete My Data…</button>
        ) : null}
      </div>
      {confirm ? (
        <div className="anim-pop mt-3 rounded-2xl border p-4" style={{ borderColor: "var(--danger)", background: "var(--surface-2)" }} role="alertdialog" aria-label="Confirm delete my data">
          <p className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>Permanently delete your wardrobe, saved outfits, analyses, feedback and wear history? This cannot be undone.</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" disabled={deleteData.isPending} onClick={() => deleteData.mutate()} className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold disabled:opacity-50" style={{ background: "var(--danger)", color: "#fff" }}>{deleteData.isPending ? "Deleting…" : "Yes, delete everything"}</button>
            <button type="button" onClick={() => setConfirm(false)} className="btn-lift rounded-full border px-5 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Keep my data</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Profile({ userId, name, email, onLogout, toast }: { userId: number; name: string; email: string; onLogout: () => void; toast: (m: string) => void }) {
  const [dnaRound, setDnaRound] = useState(0);
  const dna = useQuery({ queryKey: ["dna", userId, dnaRound], queryFn: () => api.getStyleProfile({ userId }) });
  const insights = useInsights(userId);
  const history = useQuery({ queryKey: ["feedback-history", userId], queryFn: () => api.getFeedbackHistory({ userId, limit: 12 }) });
  const d = dna.data;
  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:py-12">
      <p className="text-[11px] font-bold tracking-[0.28em] uppercase" style={{ color: "var(--accent)" }}>Style DNA</p>
      <h1 className="font-display mt-2 text-4xl font-medium md:text-5xl" style={{ color: "var(--text)" }}>{name}</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--dim)" }}>{email} · {insights.data?.totalItems ?? 0} pieces in your wardrobe</p>

      <div className="mt-9 grid gap-6 md:grid-cols-2">
        <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Your style mix">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Your Style DNA</h2>
            <button type="button" disabled={dna.isFetching} onClick={() => { setDnaRound((r) => r + 1); toast("Style DNA refreshed from your latest wardrobe ✦"); }} className="btn-lift rounded-full border px-4 py-2 text-xs font-bold disabled:opacity-50" style={{ borderColor: "var(--accent)", color: "var(--accent)" }}>
              {dna.isFetching ? "Refreshing…" : "↻ Refresh Style DNA"}
            </button>
          </div>
          <div key={dnaRound} className="mt-5 grid gap-4">
            {(d?.styles ?? []).map((s) => (
              <div key={s.label}>
                <div className="mb-1.5 flex justify-between text-sm"><span className="font-semibold" style={{ color: "var(--text)" }}>{s.label}</span><span style={{ color: "var(--dim)" }}>{s.pct}%</span></div>
                <Bar pct={s.pct} />
              </div>
            ))}
            {dna.isPending ? <p className="text-sm" style={{ color: "var(--dim)" }}>Reading your style…</p> : null}
          </div>
          <p className="font-display mt-7 text-xl italic leading-snug" style={{ color: "var(--text)" }}>“{d?.summary ?? ""}”</p>
        </section>

        <div className="grid gap-6">
          <section className="rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Colour personality">
            <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Colour Personality</h2>
            <div className="mt-4 flex flex-wrap gap-2.5">
              {(d?.colors ?? []).map((c) => (
                <span key={c.name} className="inline-flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>
                  <span className="h-4 w-4 rounded-full border" style={{ background: c.hex, borderColor: "var(--border)" }} aria-hidden="true" />{c.name}
                </span>
              ))}
            </div>
            <div className="mt-6 grid grid-cols-2 gap-4">
              <div>
                <h3 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Fit Preference</h3>
                <p className="font-display mt-2 text-3xl" style={{ color: "var(--text)" }}>{d?.fit ?? "Relaxed"}</p>
              </div>
              <div>
                <h3 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Favourite Occasions</h3>
                <p className="mt-2.5 text-sm font-semibold" style={{ color: "var(--text)" }}>{(d?.occasions ?? []).join(" · ")}</p>
              </div>
            </div>
          </section>
          <section className="rounded-3xl border p-6" style={{ background: "linear-gradient(140deg, var(--surface), var(--surface-2))", borderColor: "var(--border)" }} aria-label="What WearWise has learned">
            <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--accent)" }}>✦ What WearWise has learned</h2>
            <ul className="mt-3 grid gap-2">
              {(d?.learned ?? []).map((l) => <li key={l} className="text-sm leading-relaxed" style={{ color: "var(--text)" }}>{l}</li>)}
            </ul>
            <button type="button" onClick={() => toast("Style notes reset — WearWise will re-learn from your next choices")} className="btn-lift mt-5 rounded-full border px-4 py-2 text-xs font-semibold" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Reset learning</button>
          </section>
        </div>
      </div>

      <section className="mt-6 rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Your feedback history">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Your Feedback History</h2>
          {(history.data?.total ?? 0) > 0 ? <span className="text-xs font-semibold" style={{ color: "var(--faint)" }}>{history.data!.total} learning signal{history.data!.total === 1 ? "" : "s"} shaping your recommendations</span> : null}
        </div>
        {history.isPending ? <p className="mt-4 text-sm" style={{ color: "var(--dim)" }}>Loading your ratings…</p>
          : (history.data?.entries.length ?? 0) === 0 ? (
            <p className="mt-4 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>No ratings yet. Generate a look in the AI Stylist and rate it — Love, Like, Neutral or Not my style — and WearWise starts weighting future outfits toward what you actually enjoy.</p>
          ) : (
            <ul className="mt-4 grid gap-2.5">
              {history.data!.entries.map((e) => (
                <li key={e.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5 rounded-2xl border px-4 py-3" style={{ borderColor: "var(--border)", background: "var(--surface-2)" }}>
                  <span className="text-sm" style={{ color: "var(--text)" }}>
                    <span className="font-bold">{FEEDBACK_KIND_LABEL[e.kind] ?? e.kind}</span>
                    {e.detail ? <span style={{ color: "var(--dim)" }}> — {e.detail}</span> : null}
                  </span>
                  <time className="text-xs" style={{ color: "var(--faint)" }} dateTime={e.createdAt}>{new Date(e.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</time>
                </li>
              ))}
            </ul>
          )}
      </section>

      <section className="mt-6 rounded-3xl border p-6" style={{ background: "var(--surface)", borderColor: "var(--border)" }} aria-label="Your data controls">
        <h2 className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Your Data — Export, Reset, Delete</h2>
        <p className="mt-2 text-sm leading-relaxed" style={{ color: "var(--dim)" }}>Your wardrobe is private to your account. Export it any time, reset the demo to its initial state, or permanently delete everything wardrobe-related.</p>
        <ProfileDataControls userId={userId} toast={toast} />
      </section>

      <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t pt-6" style={{ borderColor: "var(--border)" }}>
        <p className="text-sm" style={{ color: "var(--dim)" }}>{email === "satyajeet@demo.wearwise"
          ? "Signed in to the shared demo account (no password). Your wardrobe, outfits and verdicts are saved to it — create your own account from the login screen for a private one."
          : "Signed in with your password account, protected by a server session. Your wardrobe, outfits and verdicts are saved to your account."}</p>
        <button type="button" onClick={onLogout} className="btn-lift rounded-full border px-6 py-3 text-sm font-semibold" style={{ borderColor: "var(--border)", color: "var(--danger)" }}>Log Out</button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Root                                                                */
/* ------------------------------------------------------------------ */

const APP_VIEWS: View[] = ["dashboard", "wardrobe", "add", "stylist", "snap", "buy", "shop", "analytics", "pack", "profile", "edge", "intelligence"];

const FEATURE_NAV: Array<[View, string]> = [
  ["dashboard", "Dashboard"], ["wardrobe", "My Wardrobe"], ["stylist", "AI Stylist"],
  ["snap", "Snap & Style"], ["buy", "Buy / Skip"], ["shop", "Smart Shop"],
  ["analytics", "Wardrobe Analytics"], ["profile", "Style DNA"], ["pack", "Pack Smart"],
  ["edge", "Unique Edge"], ["intelligence", "Intelligence"],
];

type SessionUser = { id: number; name: string; email: string };

function AppShell({ user, setUser }: { user: SessionUser | null; setUser: (u: SessionUser | null) => void }) {
  const qc = useQueryClient();
  const shared = useWearWise();
  const [view, setView] = useState<View>("home");
  const [authOpen, setAuthOpen] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [theme, setTheme] = useState<string>(() => safeStore.get("ww-theme") ?? "dark");
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    safeStore.set("ww-theme", theme);
  }, [theme]);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => { window.scrollTo({ top: 0 }); }, [view]);
  /* The current view is part of the shared UI state (§14 uiState). */
  useEffect(() => { shared.dispatch(storeActions.setView(view)); }, [view, shared]);

  const toast = (m: string) => { setToastMsg(m); setTimeout(() => setToastMsg(null), 3200); };

  const handleAuthSuccess = (d: ApiResponse<typeof api, "login">) => {
    setSessionToken(d.sessionToken);
    setUser(d.profile);
    safeStore.set("ww-user", JSON.stringify(d.profile));
    setAuthOpen(false); setAuthError(null);
    qc.invalidateQueries();
    setView("dashboard");
    toast(d.seeded ? "Welcome to WearWise — your real branded wardrobe is ready ✦" : d.needsRealUpgrade ? "Welcome back — tap the banner to switch to real branded clothes ✦" : "Welcome back ✦");
  };
  const loginMut = useMutation({
    mutationFn: async (a: AuthSubmit) => (a.mode === "register"
      ? await api.register({ name: a.name, email: a.email, password: a.password })
      : await api.login({ email: a.email, password: a.password })),
    onSuccess: handleAuthSuccess,
    onError: (e) => setAuthError(authErrorMessage(e)),
  });
  const demoMut = useMutation({
    mutationFn: async () => await api.demoLogin({}),
    onSuccess: handleAuthSuccess,
    onError: (e) => setAuthError(authErrorMessage(e)),
  });

  const go = (v: View) => {
    if (APP_VIEWS.includes(v) && !user) { setAuthOpen(true); return; }
    setView(v);
  };
  const logout = () => {
    /* End the server session first (the stored token hash is deleted,
       so the token dies immediately), then clear local state. */
    const token = getSessionToken();
    if (token) void api.logout({ sessionToken: token }).catch(() => { /* already signed out locally either way */ });
    setSessionToken(null);
    setUser(null);
    safeStore.remove("ww-user");
    setView("home");
    qc.clear();
    toast("Logged out — see you tomorrow morning");
  };

  const landingItems = useQuery({
    queryKey: ["items", user?.id],
    queryFn: () => api.listItems({ userId: user!.id }),
    enabled: user !== null && view === "home",
  });

  const navLink = (label: string, v: View) => (
    <button key={label} type="button" onClick={() => go(v)} aria-current={view === v ? "page" : undefined}
      className="btn-lift rounded-full px-4 py-2 text-sm font-semibold"
      style={{ color: view === v ? "var(--accent)" : "var(--text)" }}>
      {label}
    </button>
  );

  return (
    <div className="min-h-screen" style={{ background: "var(--bg)", color: "var(--text)" }}>
      {/* ---------- Header ---------- */}
      <header className="fixed inset-x-0 top-0 z-[60] pt-safe" style={{
        background: scrolled || view !== "home" ? "color-mix(in srgb, var(--bg) 82%, transparent)" : "transparent",
        backdropFilter: scrolled || view !== "home" ? "blur(16px)" : "none",
        borderBottom: scrolled ? "1px solid var(--border)" : "1px solid transparent",
        transition: "background .35s, border-color .35s",
      }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-2 px-4 py-3 md:px-5">
          <button type="button" onClick={() => setView("home")} className="btn-lift flex items-baseline gap-1.5 px-1" aria-label="WearWise home">
            <span className="font-display text-[26px] leading-none font-semibold tracking-tight" style={{ color: "var(--text)" }}>Wear<em style={{ color: "var(--accent)" }}>Wise</em></span>
          </button>
          <nav className="hidden items-center gap-1 lg:flex" aria-label="Primary">
            {navLink("Home", "home")}
            <a href="#how" onClick={() => setView("home")} className="btn-lift rounded-full px-4 py-2 text-sm font-semibold" style={{ color: "var(--text)" }}>How It Works</a>
            {navLink("AI Stylist", "stylist")}
            {navLink("Wardrobe", "wardrobe")}
            {navLink("Smart Shop", "shop")}
            {navLink("Brands", "brands")}
          </nav>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setTheme(theme === "dark" ? "light" : "dark")} aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
              className="btn-lift flex h-10 w-10 items-center justify-center rounded-full border text-base" style={{ borderColor: "var(--border)", color: "var(--text)", background: "var(--glass)" }}>
              {theme === "dark" ? "☀" : "☾"}
            </button>
            {user ? (
              <>
                <button type="button" onClick={() => setView("dashboard")} className="btn-lift hidden rounded-full border px-4 py-2 text-sm font-semibold sm:block" style={{ borderColor: "var(--border)", color: "var(--text)" }}>Dashboard</button>
                <button type="button" onClick={() => setView("profile")} aria-label={`Profile of ${user.name}`} className="btn-lift flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>
                  {user.name.charAt(0).toUpperCase()}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => setAuthOpen(true)} className="btn-lift rounded-full px-4 py-2 text-sm font-semibold" style={{ color: "var(--text)" }}>Log In</button>
                <button type="button" onClick={() => setAuthOpen(true)} className="btn-lift rounded-full px-5 py-2.5 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Get Started</button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className={view === "home" ? "pt-[68px]" : "pt-[76px] pb-24 md:pb-10"}>
        {view === "home" ? <Landing go={go} openAuth={() => setAuthOpen(true)} items={landingItems.data?.items ?? []} /> : null}
        {user && view !== "home" && view !== "brands" ? (
          <nav className="mx-auto max-w-6xl px-5 pt-5" aria-label="WearWise features">
            <div className="flex gap-2 overflow-x-auto no-scrollbar pb-1">
              {FEATURE_NAV.map(([v, label]) => (
                <button key={v} type="button" onClick={() => go(v)} aria-current={view === v ? "page" : undefined}
                  className="btn-lift shrink-0 rounded-full border px-4 py-2 text-[13px] font-semibold"
                  style={view === v
                    ? { background: "var(--accent)", color: "var(--accent-ink)", borderColor: "var(--accent)" }
                    : { borderColor: "var(--border)", color: "var(--text)", background: "var(--surface)" }}>
                  {label}
                </button>
              ))}
            </div>
          </nav>
        ) : null}
        {user && view === "dashboard" ? <Dashboard userId={user.id} name={user.name} go={go} toast={toast} /> : null}
        {user && view === "wardrobe" ? <Wardrobe userId={user.id} go={go} toast={toast} /> : null}
        {user && view === "add" ? <AddClothing userId={user.id} go={go} toast={toast} /> : null}
        {user && view === "stylist" ? <Stylist userId={user.id} toast={toast} /> : null}
        {user && view === "snap" ? <SnapStyle userId={user.id} go={go} /> : null}
        {user && view === "buy" ? <BuySkip userId={user.id} go={go} /> : null}
        {user && view === "shop" ? <Shop userId={user.id} toast={toast} go={go} /> : null}
        {user && view === "analytics" ? <AnalyticsPage userId={user.id} go={go} /> : null}
        {user && view === "pack" ? <PackSmart userId={user.id} /> : null}
        {user && view === "edge" ? <UniqueEdge userId={user.id} go={go} toast={toast} /> : null}
        {user && view === "intelligence" ? <Intelligence userId={user.id} go={go} toast={toast} /> : null}
        {view === "brands" ? <Brands userId={user?.id ?? null} go={go} /> : null}
        {user && view === "profile" ? <Profile userId={user.id} name={user.name} email={user.email} onLogout={logout} toast={toast} /> : null}
        {!user && APP_VIEWS.includes(view) ? (
          <div className="mx-auto max-w-md px-5 py-20 text-center">
            <p className="font-display text-3xl" style={{ color: "var(--text)" }}>Log in to open your wardrobe.</p>
            <button type="button" onClick={() => setAuthOpen(true)} className="btn-lift mt-6 rounded-full px-7 py-3 text-sm font-bold" style={{ background: "var(--accent)", color: "var(--accent-ink)" }}>Log In</button>
          </div>
        ) : null}
      </main>

      {/* ---------- Footer ---------- */}
      <footer className="border-t pb-28 md:pb-10" style={{ borderColor: "var(--border)", background: "var(--bg-2)" }}>
        <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <p className="font-display text-3xl font-semibold" style={{ color: "var(--text)" }}>Wear<em style={{ color: "var(--accent)" }}>Wise</em></p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed" style={{ color: "var(--dim)" }}>AI wardrobe intelligence for everyday decisions.</p>
            <p className="mt-4 text-xs font-bold tracking-[0.2em] uppercase" style={{ color: "var(--faint)" }}>Know what you own · Know what to wear · Know what to buy</p>
          </div>
          <nav aria-label="Product">
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Product</p>
            <ul className="mt-3 grid gap-2 text-sm">
              <li><button type="button" onClick={() => go("stylist")} className="btn-lift font-medium" style={{ color: "var(--text)" }}>AI Stylist</button></li>
              <li><button type="button" onClick={() => go("wardrobe")} className="btn-lift font-medium" style={{ color: "var(--text)" }}>Wardrobe</button></li>
              <li><button type="button" onClick={() => go("shop")} className="btn-lift font-medium" style={{ color: "var(--text)" }}>Smart Shop</button></li>
              <li><button type="button" onClick={() => setView("brands")} className="btn-lift font-medium" style={{ color: "var(--text)" }}>All Brands A–Z</button></li>
              <li><button type="button" onClick={() => go("buy")} className="btn-lift font-medium" style={{ color: "var(--text)" }}>Buy or Skip</button></li>
            </ul>
          </nav>
          <nav aria-label="Company">
            <p className="text-[11px] font-bold tracking-[0.22em] uppercase" style={{ color: "var(--dim)" }}>Company</p>
            <ul className="mt-3 grid gap-2 text-sm">
              <li><button type="button" onClick={() => { setView("home"); setTimeout(() => document.querySelector("#how")?.scrollIntoView({ behavior: "smooth" }), 60); }} className="btn-lift font-medium" style={{ color: "var(--text)" }}>About</button></li>
              <li><button type="button" onClick={() => toast("Privacy: your wardrobe data lives in your WearWise account and is never sold.")} className="btn-lift font-medium" style={{ color: "var(--text)" }}>Privacy</button></li>
              <li><button type="button" onClick={() => toast("Terms: WearWise is a styling assistant — final fashion decisions are gloriously yours.")} className="btn-lift font-medium" style={{ color: "var(--text)" }}>Terms</button></li>
            </ul>
            <div className="mt-5 flex gap-2" aria-label="Social links">
              {[["Instagram", "◎"], ["X", "𝕏"], ["YouTube", "▷"]].map(([label, glyph]) => (
                <button key={label} type="button" aria-label={`WearWise on ${label}`} onClick={() => toast(`WearWise on ${label} — launching with the public beta`)}
                  className="btn-lift flex h-10 w-10 items-center justify-center rounded-full border text-sm" style={{ borderColor: "var(--border)", color: "var(--text)" }}>{glyph}</button>
              ))}
            </div>
          </nav>
        </div>
        <p className="text-center text-xs" style={{ color: "var(--faint)" }}>© 2026 WearWise</p>
      </footer>

      {/* ---------- Mobile bottom nav ---------- */}
      <nav className="fixed inset-x-0 bottom-0 z-[60] pb-safe md:hidden" aria-label="Mobile"
        style={{ background: "color-mix(in srgb, var(--bg) 86%, transparent)", backdropFilter: "blur(16px)", borderTop: "1px solid var(--border)" }}>
        <div className="grid grid-cols-5">
          {([["home", "Home", "⌂"], ["wardrobe", "Wardrobe", "▦"], ["stylist", "AI Stylist", "✦"], ["snap", "Snap", "📸"], ["buy", "Buy/Skip", "⚖"]] as Array<[View, string, string]>).map(([v, label, glyph]) => {
            const target: View = v === "home" && user ? "dashboard" : v;
            const active = view === target || (v === "home" && !user && view === "home");
            return (
              <button key={v} type="button" onClick={() => go(target)} aria-current={active ? "page" : undefined}
                className="flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-bold"
                style={{ color: active ? "var(--accent)" : "var(--dim)" }}>
                <span className="text-lg leading-none" aria-hidden="true">{glyph}</span>{label}
              </button>
            );
          })}
        </div>
      </nav>

      {user ? <AskWearWise userId={user.id} go={go} toast={toast} /> : null}
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} busy={loginMut.isPending || demoMut.isPending} error={authError}
        onLogin={(a) => loginMut.mutate(a)} onDemo={() => demoMut.mutate()} />
      <Toast msg={toastMsg} />
    </div>
  );
}

/* Root — the global WearWise store wraps the whole shell (§14).
   Session state lives here so WearWiseProvider receives the signed-in
   user directly and can own the core queries from first render;
   AppShell's own queries use the identical React Query keys, so there
   is still exactly one fetch per entity, shared by everything. */
export function App() {
  const [user, setUser] = useState<SessionUser | null>(() => {
    try { const raw = safeStore.get("ww-user"); return raw ? (JSON.parse(raw) as SessionUser) : null; } catch { return null; }
  });
  /* Revalidate the saved sign-in against the server session on load.
     A saved profile alone is no longer enough: without a live session
     token the sign-in is dropped (accounts saved by the old name +
     email login log in once with a password, which claims them), and
     an expired/revoked token signs the user out cleanly instead of
     leaving a shell that fails on every action. */
  useEffect(() => {
    const token = getSessionToken();
    if (!token) {
      if (user) { setUser(null); safeStore.remove("ww-user"); }
      return;
    }
    let cancelled = false;
    api.getSession({ sessionToken: token }).then((d) => {
      if (cancelled) return;
      if (!d.profile) {
        setSessionToken(null);
        setUser(null);
        safeStore.remove("ww-user");
      } else if (!user || d.profile.id !== user.id) {
        setUser(d.profile);
        safeStore.set("ww-user", JSON.stringify(d.profile));
      }
    }).catch(() => { /* offline or transient — keep the saved session; actions will surface real errors */ });
    return () => { cancelled = true; };
    // Run once on mount; `user` is the initial saved profile by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <WearWiseProvider user={user}>
      <AppShell user={user} setUser={setUser} />
    </WearWiseProvider>
  );
}
