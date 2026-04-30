import express from "express";
import cors from "cors";
import multer from "multer";
import { PDFParse } from "pdf-parse";
import "./config/env";
import { getOpenAIClient, OPENAI_MODEL } from "./config/openai";
import { supabase } from "./config/supabase";

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024,
  },
});

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("API calisiyor");
});

app.get("/notes", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const tag = String(req.query.tag || "").trim();

  if (tag) {
    const { data, error } = await supabase
      .from("notes")
      .select("*")
      .contains("tags", [tag])
      .order("created_at", { ascending: false });

    if (error) {
      return handleSupabaseError(res, error);
    }

    return res.json(data);
  }

  let query = supabase
    .from("notes")
    .select("*")
    .order("created_at", { ascending: false });

  if (search) {
    const safeSearch = search.replace(/[%,]/g, "");
    query = query.or(`title.ilike.%${safeSearch}%,content.ilike.%${safeSearch}%`);
  }

  const { data, error } = await query;

  if (error) {
    return handleSupabaseError(res, error);
  }

  res.json(data);
});

app.post("/notes", async (req, res) => {
  const { title, content, tags } = req.body;

  if (!title) {
    return res.status(400).json({ error: "title zorunlu" });
  }

  const { data, error } = await supabase
    .from("notes")
    .insert([{ title, content, tags: normalizeTags(tags) }])
    .select();

  if (error) {
    if (isMissingColumnError(error, "tags")) {
      const retry = await supabase.from("notes").insert([{ title, content }]).select();

      if (retry.error) {
        return handleSupabaseError(res, retry.error);
      }

      return res.status(201).json(retry.data);
    }

    return handleSupabaseError(res, error);
  }

  res.status(201).json(data);
});

app.put("/notes/:id", async (req, res) => {
  const { id } = req.params;
  const { title, content, tags } = req.body;

  if (!title) {
    return res.status(400).json({ error: "title zorunlu" });
  }

  const { data, error } = await supabase
    .from("notes")
    .update({ title, content, tags: normalizeTags(tags) })
    .eq("id", id)
    .select();

  if (error) {
    if (isMissingColumnError(error, "tags")) {
      const retry = await supabase
        .from("notes")
        .update({ title, content })
        .eq("id", id)
        .select();

      if (retry.error) {
        return handleSupabaseError(res, retry.error);
      }

      return res.json(retry.data);
    }

    return handleSupabaseError(res, error);
  }

  res.json(data);
});

app.delete("/notes/:id", async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase.from("notes").delete().eq("id", id);

  if (error) {
    return handleSupabaseError(res, error);
  }

  res.status(204).send();
});

app.post("/notes/:id/summarize", async (req, res) => {
  try {
    const note = await getNote(req.params.id);
    const summary = await generateText(
      getSummaryInstructions(note),
      noteText(note)
    );

    res.json({ id: note.id, summary });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/notes/:id/tags", async (req, res) => {
  try {
    const note = await getNote(req.params.id);
    const output = await generateText(
      'Verilen not icin 3-6 kisa Turkce etiket uret. Sadece JSON string array dondur. Ornek: ["matematik","ozet"]',
      noteText(note)
    );
    const tags = parseStringArray(output);

    res.json({ id: note.id, tags });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/notes/:id/quiz", async (req, res) => {
  try {
    const note = await getNote(req.params.id);
    const output = await generateText(
      [
        "Verilen nottan 5 soruluk Turkce quiz olustur.",
        "Sadece JSON array dondur.",
        "Her eleman su formatta olsun:",
        '{"question":"...","options":["A) ...","B) ...","C) ...","D) ..."],"answer":"A","explanation":"..."}',
        "options alanindaki her sik anlamli bir cevap metni icersin; sadece A, B, C, D yazma.",
        "answer alaninda dogru sikkin sadece harfini yaz.",
      ].join(" "),
      noteText(note)
    );
    const quiz = parseJsonArray(output);

    res.json({ id: note.id, quiz });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/chat", async (req, res) => {
  try {
    const { message, contextTitle, context } = req.body;

    if (!message || typeof message !== "string") {
      return res.status(400).json({ error: "message zorunlu" });
    }

    if (!context || typeof context !== "string") {
      return res.status(400).json({ error: "context zorunlu" });
    }

    const answer = await generateText(
      getChatInstructions(String(contextTitle || "SmartNotes icerigi")),
      [
        `Konu: ${String(contextTitle || "SmartNotes icerigi")}`,
        "",
        "Baglam:",
        context.slice(0, 45000),
        "",
        "Kullanici sorusu:",
        message,
      ].join("\n")
    );

    res.json({ answer });
  } catch (error) {
    handleError(res, error);
  }
});

app.post("/documents/analyze", upload.single("document"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "PDF dosyasi zorunlu" });
    }

    if (req.file.mimetype !== "application/pdf") {
      return res.status(400).json({ error: "Sadece PDF dosyasi yukleyebilirsin" });
    }

    const parsed = await extractPdfText(req.file.buffer);
    const text = normalizeDocumentText(parsed.text);

    if (!text) {
      return res.status(400).json({ error: "PDF icinden okunabilir metin bulunamadi" });
    }

    const output = await generateText(
      getDocumentAnalysisInstructions(countWords(text), parsed.total),
      text.slice(0, 45000)
    );
    const analysis = parseDocumentAnalysis(output);

    res.json({
      fileName: req.file.originalname,
      pageCount: parsed.total,
      wordCount: countWords(text),
      ...analysis,
    });
  } catch (error) {
    handleError(res, error);
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

type NoteRecord = {
  id: string;
  title: string;
  content: string | null;
};

type DocumentAnalysis = {
  summary: string;
  keyPoints: string[];
  importantSections: string[];
  actionItems: string[];
};

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  return tags
    .filter((tag): tag is string => typeof tag === "string")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 10);
}

async function getNote(id: string): Promise<NoteRecord> {
  const { data, error } = await supabase
    .from("notes")
    .select("id,title,content")
    .eq("id", id)
    .single();

  if (error) {
    throw error;
  }

  return data;
}

function noteText(note: NoteRecord): string {
  return `Baslik: ${note.title}\n\nIcerik:\n${note.content || ""}`;
}

function getSummaryInstructions(note: NoteRecord): string {
  const wordCount = countWords(`${note.title} ${note.content || ""}`);
  const lengthRule = getSummaryLengthRule(wordCount);

  return [
    "Sen bir Turkce calisma notu asistanisin.",
    `Notun uzunlugu yaklasik ${wordCount} kelime. ${lengthRule}`,
    "Verilen notu mevcut yazinin uzunluguna gore ozetle; kisa notlara gereksiz uzun, uzun notlara gereksiz kisa ozet yazma.",
    "Gereksiz tekrar yapmadan, sinava veya tekrar calismaya uygun olacak sekilde acik ve duzenli anlat.",
    "Ozetin en altina 'Ana fikir:' basligi ile tek cumlelik ana fikri ekle.",
  ].join(" ");
}

function countWords(value: string): number {
  return value.trim().split(/\s+/).filter(Boolean).length;
}

function getSummaryLengthRule(wordCount: number): string {
  if (wordCount < 25) {
    return "Ozet 1 cok kisa cumle olsun.";
  }

  if (wordCount < 50) {
    return "Ozet 1-2 kisa cumle olsun.";
  }

  if (wordCount < 75) {
    return "Ozet 2 kisa cumle olsun.";
  }

  if (wordCount < 110) {
    return "Ozet 2-3 cumle olsun.";
  }

  if (wordCount < 160) {
    return "Ozet 3-4 cumle olsun.";
  }

  if (wordCount < 220) {
    return "Ozet 4-6 cumle olsun.";
  }

  if (wordCount < 320) {
    return "Ozet 1 paragraf olsun, yaklasik 5-7 cumle kullan.";
  }

  if (wordCount < 450) {
    return "Ozet 1 uzun paragraf veya 2 kisa paragraf olsun.";
  }

  if (wordCount < 600) {
    return "Ozet 2 paragraf olsun; birinci paragraf ana fikir, ikinci paragraf detaylar icin olsun.";
  }

  if (wordCount < 800) {
    return "Ozet 3 paragraf olsun; gerekirse en fazla 2 kisa alt baslik kullan.";
  }

  if (wordCount < 1050) {
    return "Ozet 3-4 paragraf olsun ve ana bolumleri kisa alt basliklarla ayir.";
  }

  if (wordCount < 1350) {
    return "Ozet 4 paragraf olsun; kavramlar, surec ve sonuc gibi bolumleri ayir.";
  }

  if (wordCount < 1700) {
    return "Ozet 5 paragraf olsun; alt basliklarla ana konu, detaylar, ornekler ve sonuc bolumlerini ayir.";
  }

  if (wordCount < 2200) {
    return "Ozet 6-7 paragraf olsun; alt basliklarla ana temalari ayir ve kritik detaylari koru.";
  }

  if (wordCount < 3000) {
    return "Ozet 8-9 paragraf olsun; ana bolumleri alt basliklarla ayir, onemli kavramlari ve sonuc iliskilerini koru.";
  }

  if (wordCount < 4000) {
    return "Ozet 10-12 paragraf olsun; bolumlu bir calisma notu gibi yaz ve uzun metindeki temel detaylari koru.";
  }

  return "Ozet 12-15 paragraf olsun; bolumlu, kapsamli bir calisma notu gibi yaz ve ana detaylari kaybetme.";
}

function normalizeDocumentText(value: string): string {
  return value
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function extractPdfText(buffer: Buffer) {
  const parser = new PDFParse({ data: buffer });

  try {
    return await parser.getText();
  } finally {
    await parser.destroy();
  }
}

function getDocumentAnalysisInstructions(wordCount: number, pageCount: number): string {
  return [
    "Sen Turkce dokuman analizi yapan bir asistansin.",
    `PDF yaklasik ${pageCount} sayfa ve ${wordCount} kelime.`,
    "Ders notu, rapor veya is dokumani gibi dusunerek kullanicinin hizli calismasini sagla.",
    "Sadece gecerli JSON dondur. Markdown kullanma.",
    "JSON formati tam olarak su olsun:",
    '{"summary":"...","keyPoints":["..."],"importantSections":["..."],"actionItems":["..."]}',
    "summary alaninda 1-3 paragraf net ozet yaz.",
    "keyPoints alaninda en onemli 5-8 maddeyi yaz.",
    "importantSections alaninda dokumandaki kritik bolumleri, kavramlari veya karar noktalarini yaz.",
    "actionItems alaninda tekrar, sinav, toplanti veya is takibi icin uygulanabilir maddeleri yaz.",
  ].join(" ");
}

function parseDocumentAnalysis(value: string): DocumentAnalysis {
  const parsed = parseJsonObject(value);

  return {
    summary: getStringValue(parsed.summary),
    keyPoints: normalizeStringList(parsed.keyPoints),
    importantSections: normalizeStringList(parsed.importantSections),
    actionItems: normalizeStringList(parsed.actionItems),
  };
}

function getChatInstructions(contextTitle: string): string {
  return [
    "Sen SmartNotes icinde calisan Turkce bir calisma ve dokuman asistanisin.",
    `Kullanici '${contextTitle}' baglami hakkinda soru soruyor.`,
    "Cevabini yalnizca verilen baglama dayanarak ver.",
    "Baglamda cevap yoksa bunu acikca soyle ve tahmin uretme.",
    "Gerekirse kisa maddeler kullan; net, pratik ve ogrenci/is kullanicisina uygun cevap ver.",
  ].join(" ");
}

async function generateText(instructions: string, input: string): Promise<string> {
  const openai = getOpenAIClient();
  const response = await openai.responses.create({
    model: OPENAI_MODEL,
    instructions,
    input,
    store: false,
  });

  return response.output_text.trim();
}

function parseStringArray(value: string): string[] {
  const parsed = parseJsonArray(value);
  return normalizeTags(parsed);
}

function parseJsonArray(value: string): unknown[] {
  const parsed = JSON.parse(cleanJson(value));

  if (!Array.isArray(parsed)) {
    throw new Error("AI response is not a JSON array.");
  }

  return parsed;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(cleanJson(value));

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("AI response is not a JSON object.");
  }

  return parsed as Record<string, unknown>;
}

function cleanJson(value: string): string {
  const cleaned = value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();

  return cleaned;
}

function getStringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeStringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function handleError(res: express.Response, error: unknown) {
  const message = error instanceof Error ? error.message : "Beklenmeyen hata";
  res.status(500).json({ error: message });
}

function handleSupabaseError(res: express.Response, error: unknown) {
  if (isMissingFeatureColumnError(error)) {
    return res.status(400).json({
      error:
        "Supabase notes tablosunda AI/etiket kolonlari eksik. server/supabase.sql dosyasini Supabase SQL Editor'da calistir.",
    });
  }

  return res.status(500).json({ error });
}

function isMissingFeatureColumnError(error: unknown) {
  return ["summary", "tags", "quiz"].some((column) => isMissingColumnError(error, column));
}

function isMissingColumnError(error: unknown, column: string) {
  const message = getErrorMessage(error).toLowerCase();
  return (
    message.includes(`'${column}' column`) ||
    message.includes(`"${column}" column`) ||
    message.includes(`${column} column`) ||
    message.includes(`column "${column}"`) ||
    message.includes(`column '${column}'`)
  );
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    return typeof message === "string" ? message : "";
  }

  return "";
}
