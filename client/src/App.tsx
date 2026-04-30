import { useEffect, useMemo, useState, type FormEvent } from "react";

type QuizQuestion = {
  question: string;
  options: string[];
  answer: string;
  explanation?: string;
};

type Note = {
  id: string;
  title: string;
  content: string | null;
  created_at: string;
  tags?: string[] | null;
  summary?: string | null;
  quiz?: QuizQuestion[] | null;
};

type DocumentAnalysis = {
  fileName: string;
  pageCount: number;
  wordCount: number;
  summary: string;
  keyPoints: string[];
  importantSections: string[];
  actionItems: string[];
};

type ChatMessage = {
  role: "user" | "assistant";
  text: string;
};

type AiResult =
  | { id: string; summary: string }
  | { id: string; tags: string[] }
  | { id: string; quiz: QuizQuestion[] };

const API_URL = import.meta.env.VITE_API_URL;

function App() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [tagsText, setTagsText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState("");
  const [loading, setLoading] = useState(false);
  const [busyNoteId, setBusyNoteId] = useState<string | null>(null);
  const [documentFile, setDocumentFile] = useState<File | null>(null);
  const [documentAnalysis, setDocumentAnalysis] = useState<DocumentAnalysis | null>(null);
  const [documentLoading, setDocumentLoading] = useState(false);
  const [quizAnswers, setQuizAnswers] = useState<Record<string, Record<number, string>>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<Record<string, boolean>>({});
  const [chatInputs, setChatInputs] = useState<Record<string, string>>({});
  const [chatMessages, setChatMessages] = useState<Record<string, ChatMessage[]>>({});
  const [busyChatKey, setBusyChatKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const allTags = useMemo(
    () =>
      Array.from(new Set(notes.flatMap((note) => note.tags || []))).sort((a, b) =>
        a.localeCompare(b)
      ),
    [notes]
  );

  const getNotes = async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams();

      if (search.trim()) {
        params.set("search", search.trim());
      }

      if (selectedTag) {
        params.set("tag", selectedTag);
      }

      const url = `${API_URL}/notes${params.toString() ? `?${params}` : ""}`;
      const res = await fetch(url);
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Notlar alınamadı");
      }

      setNotes(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setLoading(false);
    }
  };

  const saveNote = async (e: FormEvent) => {
    e.preventDefault();
    setError("");

    const url = editingId ? `${API_URL}/notes/${editingId}` : `${API_URL}/notes`;
    const method = editingId ? "PUT" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title,
          content,
          tags: parseTags(tagsText),
        }),
      });
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error?.message || data.error || "Not kaydedilemedi");
      }

      resetForm();
      getNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    }
  };

  const editNote = (note: Note) => {
    setEditingId(note.id);
    setTitle(note.title);
    setContent(note.content || "");
    setTagsText((note.tags || []).join(", "));
  };

  const deleteNote = async (id: string) => {
    setBusyNoteId(id);
    setError("");

    try {
      const res = await fetch(`${API_URL}/notes/${id}`, { method: "DELETE" });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error?.message || data.error || "Not silinemedi");
      }

      if (editingId === id) {
        resetForm();
      }

      getNotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setBusyNoteId(null);
    }
  };

  const runAiAction = async (noteId: string, action: "summarize" | "tags" | "quiz") => {
    setBusyNoteId(noteId);
    setError("");

    try {
      const res = await fetch(`${API_URL}/notes/${noteId}/${action}`, {
        method: "POST",
      });
      const data: AiResult & { error?: string | { message?: string } } = await res.json();

      if (!res.ok) {
        const errorMessage =
          typeof data.error === "object" ? data.error.message : data.error;
        throw new Error(errorMessage || "AI işlemi başarısız");
      }

      setNotes((current) =>
        current.map((note) => (note.id === noteId ? { ...note, ...data } : note))
      );

      if (action === "quiz") {
        setQuizAnswers((current) => ({ ...current, [noteId]: {} }));
        setQuizSubmitted((current) => ({ ...current, [noteId]: false }));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setBusyNoteId(null);
    }
  };

  const analyzeDocument = async (e: FormEvent) => {
    e.preventDefault();

    if (!documentFile) {
      setError("Analiz için PDF seçmelisin");
      return;
    }

    setDocumentLoading(true);
    setDocumentAnalysis(null);
    setError("");

    try {
      const formData = new FormData();
      formData.append("document", documentFile);

      const res = await fetch(`${API_URL}/documents/analyze`, {
        method: "POST",
        body: formData,
      });
      const data: DocumentAnalysis & { error?: string | { message?: string } } =
        await res.json();

      if (!res.ok) {
        const errorMessage =
          typeof data.error === "object" ? data.error.message : data.error;
        throw new Error(errorMessage || "Doküman analiz edilemedi");
      }

      setDocumentAnalysis(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setDocumentLoading(false);
    }
  };

  const updateQuizAnswer = (noteId: string, questionIndex: number, value: string) => {
    setQuizAnswers((current) => ({
      ...current,
      [noteId]: {
        ...(current[noteId] || {}),
        [questionIndex]: value,
      },
    }));
  };

  const submitQuiz = (noteId: string) => {
    setQuizSubmitted((current) => ({ ...current, [noteId]: true }));
  };

  const updateChatInput = (chatKey: string, value: string) => {
    setChatInputs((current) => ({ ...current, [chatKey]: value }));
  };

  const sendChatMessage = async (chatKey: string, contextTitle: string, context: string) => {
    const message = (chatInputs[chatKey] || "").trim();

    if (!message) {
      return;
    }

    setBusyChatKey(chatKey);
    setError("");
    setChatInputs((current) => ({ ...current, [chatKey]: "" }));
    setChatMessages((current) => ({
      ...current,
      [chatKey]: [...(current[chatKey] || []), { role: "user", text: message }],
    }));

    try {
      const res = await fetch(`${API_URL}/chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ message, contextTitle, context }),
      });
      const data: { answer?: string; error?: string | { message?: string } } =
        await res.json();

      if (!res.ok) {
        const errorMessage =
          typeof data.error === "object" ? data.error.message : data.error;
        throw new Error(errorMessage || "Sohbet cevabi alinamadi");
      }

      setChatMessages((current) => ({
        ...current,
        [chatKey]: [
          ...(current[chatKey] || []),
          { role: "assistant", text: data.answer || "" },
        ],
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setBusyChatKey(null);
    }
  };

  const resetForm = () => {
    setTitle("");
    setContent("");
    setTagsText("");
    setEditingId(null);
  };

  useEffect(() => {
    getNotes();
  }, [selectedTag]);

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <h1>SmartNotes</h1>
          <p>Notlarını yaz, ara, etiketle ve AI ile çalışmaya hazır hale getir.</p>
        </div>
      </header>

      {error && <div className="alert">{error}</div>}

      <section className="workspace">
        <form className="note-form" onSubmit={saveNote}>
          <h2>{editingId ? "Notu düzenle" : "Yeni not"}</h2>

          <label>
            Başlık
            <input
              placeholder="Başlık"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
            />
          </label>

          <label>
            İçerik
            <textarea
              placeholder="İçerik"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={8}
            />
          </label>

          <label>
            Etiketler
            <input
              placeholder="ders, proje, önemli"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
            />
          </label>

          <div className="form-actions">
            <button type="submit">{editingId ? "Güncelle" : "Ekle"}</button>
            {editingId && (
              <button type="button" className="secondary" onClick={resetForm}>
                Vazgeç
              </button>
            )}
          </div>
        </form>

        <section className="notes-panel">
          <section className="document-panel">
            <div>
              <h2>PDF / Doküman Analizi</h2>
              <p className="muted">
                PDF yükle; AI özet, önemli noktalar ve yapılacakları çıkarsın.
              </p>
            </div>

            <form className="document-form" onSubmit={analyzeDocument}>
              <input
                type="file"
                accept="application/pdf"
                onChange={(e) => setDocumentFile(e.target.files?.[0] || null)}
              />
              <button type="submit" disabled={documentLoading}>
                {documentLoading ? "Analiz ediliyor..." : "PDF Analiz Et"}
              </button>
            </form>

            {documentAnalysis && (
              <div className="document-result">
                <div className="document-meta">
                  <strong>{documentAnalysis.fileName}</strong>
                  <span>
                    {documentAnalysis.pageCount} sayfa · {documentAnalysis.wordCount} kelime
                  </span>
                </div>

                <section>
                  <h3>Özet</h3>
                  <p>{documentAnalysis.summary}</p>
                </section>

                <AnalysisList title="Önemli noktalar" items={documentAnalysis.keyPoints} />
                <AnalysisList
                  title="Kritik bölümler"
                  items={documentAnalysis.importantSections}
                />
                <AnalysisList title="Aksiyonlar" items={documentAnalysis.actionItems} />
                <AiChat
                  chatKey="document-analysis"
                  title="PDF hakkinda sor"
                  input={chatInputs["document-analysis"] || ""}
                  messages={chatMessages["document-analysis"] || []}
                  loading={busyChatKey === "document-analysis"}
                  onInputChange={updateChatInput}
                  onSend={() =>
                    sendChatMessage(
                      "document-analysis",
                      documentAnalysis.fileName,
                      documentAnalysisToText(documentAnalysis)
                    )
                  }
                />
              </div>
            )}
          </section>

          <div className="filters">
            <input
              placeholder="Notlarda ara"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  getNotes();
                }
              }}
            />
            <button type="button" onClick={getNotes}>
              Ara
            </button>
            <select value={selectedTag} onChange={(e) => setSelectedTag(e.target.value)}>
              <option value="">Tüm etiketler</option>
              {allTags.map((tag) => (
                <option key={tag} value={tag}>
                  {tag}
                </option>
              ))}
            </select>
          </div>

          {loading && <p className="muted">Yükleniyor...</p>}

          {!loading && notes.length === 0 && (
            <p className="muted">Henüz gösterilecek not yok.</p>
          )}

          <div className="notes-list">
            {notes.map((note) => (
              <article className="note-card" key={note.id}>
                <div className="note-header">
                  <h2>{note.title}</h2>
                  <div className="note-actions">
                    <button type="button" className="secondary" onClick={() => editNote(note)}>
                      Düzenle
                    </button>
                    <button
                      type="button"
                      className="danger"
                      disabled={busyNoteId === note.id}
                      onClick={() => deleteNote(note.id)}
                    >
                      Sil
                    </button>
                  </div>
                </div>

                <p className="note-content">{note.content}</p>

                {!!note.tags?.length && (
                  <div className="tags">
                    {note.tags.map((tag) => (
                      <button
                        type="button"
                        className="tag"
                        key={tag}
                        onClick={() => setSelectedTag(tag)}
                      >
                        {tag}
                      </button>
                    ))}
                  </div>
                )}

                <div className="ai-actions">
                  <button
                    type="button"
                    disabled={busyNoteId === note.id}
                    onClick={() => runAiAction(note.id, "summarize")}
                  >
                    {busyNoteId === note.id ? "Hazırlanıyor..." : "Özet Çıkar"}
                  </button>
                  <button
                    type="button"
                    disabled={busyNoteId === note.id}
                    onClick={() => runAiAction(note.id, "tags")}
                  >
                    AI Etiket
                  </button>
                  <button
                    type="button"
                    disabled={busyNoteId === note.id}
                    onClick={() => runAiAction(note.id, "quiz")}
                  >
                    Quiz Oluştur
                  </button>
                </div>

                {note.summary && (
                  <section className="summary">
                    <h3>Özet</h3>
                    <p>{note.summary}</p>
                  </section>
                )}

                {!!note.quiz?.length && (
                  <QuizSection
                    noteId={note.id}
                    quiz={note.quiz}
                    answers={quizAnswers[note.id] || {}}
                    submitted={!!quizSubmitted[note.id]}
                    onAnswerChange={updateQuizAnswer}
                    onSubmit={submitQuiz}
                  />
                )}

                <AiChat
                  chatKey={`note-${note.id}`}
                  title="Bu not hakkinda sor"
                  input={chatInputs[`note-${note.id}`] || ""}
                  messages={chatMessages[`note-${note.id}`] || []}
                  loading={busyChatKey === `note-${note.id}`}
                  onInputChange={updateChatInput}
                  onSend={() =>
                    sendChatMessage(
                      `note-${note.id}`,
                      note.title,
                      noteToChatContext(note)
                    )
                  }
                />
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function QuizSection({
  noteId,
  quiz,
  answers,
  submitted,
  onAnswerChange,
  onSubmit,
}: {
  noteId: string;
  quiz: QuizQuestion[];
  answers: Record<number, string>;
  submitted: boolean;
  onAnswerChange: (noteId: string, questionIndex: number, value: string) => void;
  onSubmit: (noteId: string) => void;
}) {
  const score = submitted
    ? quiz.filter((item, index) => isCorrectAnswer(answers[index], item.answer)).length
    : 0;

  return (
    <section className="quiz">
      <div className="quiz-header">
        <h3>Quiz</h3>
        {submitted && (
          <strong>
            Sonuç: {score}/{quiz.length}
          </strong>
        )}
      </div>

      {quiz.map((item, index) => {
        const userAnswer = answers[index] || "";
        const isCorrect = isCorrectAnswer(userAnswer, item.answer);

        return (
          <div className="quiz-item" key={`${noteId}-${index}`}>
            <strong>
              {index + 1}. {item.question}
            </strong>
            <div className="quiz-options">
              {item.options.map((option) => (
                <button
                  type="button"
                  className={getQuizOptionClass(option, userAnswer, item.answer, submitted)}
                  key={option}
                  disabled={submitted}
                  onClick={() => onAnswerChange(noteId, index, option)}
                >
                  {option}
                </button>
              ))}
            </div>
            <label className="quiz-answer-field" hidden>
              Cevabın
              <input
                placeholder="A, B, C, D veya cevabını yaz"
                value={userAnswer}
                disabled={submitted}
                onChange={(e) => onAnswerChange(noteId, index, e.target.value)}
              />
            </label>

            {submitted && (
              <div className={isCorrect ? "quiz-result correct" : "quiz-result wrong"}>
                <strong>{isCorrect ? "Doğru" : "Yanlış"}</strong>
                <p>Doğru cevap: {item.answer}</p>
                {item.explanation && <p>{item.explanation}</p>}
              </div>
            )}
          </div>
        );
      })}

      {!submitted && (
        <button type="button" onClick={() => onSubmit(noteId)}>
          Sonuçlandır
        </button>
      )}
    </section>
  );
}

function AiChat({
  chatKey,
  title,
  input,
  messages,
  loading,
  onInputChange,
  onSend,
}: {
  chatKey: string;
  title: string;
  input: string;
  messages: ChatMessage[];
  loading: boolean;
  onInputChange: (chatKey: string, value: string) => void;
  onSend: () => void;
}) {
  return (
    <section className="ai-chat">
      <h3>{title}</h3>

      {messages.length > 0 && (
        <div className="chat-messages">
          {messages.map((message, index) => (
            <div className={`chat-message ${message.role}`} key={`${chatKey}-${index}`}>
              <strong>{message.role === "user" ? "Sen" : "AI"}</strong>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
      )}

      <form
        className="chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input
          placeholder="Bu icerik hakkinda soru sor"
          value={input}
          onChange={(e) => onInputChange(chatKey, e.target.value)}
        />
        <button type="submit" disabled={loading || !input.trim()}>
          {loading ? "Yanitlaniyor..." : "Sor"}
        </button>
      </form>
    </section>
  );
}

function AnalysisList({ title, items }: { title: string; items: string[] }) {
  if (items.length === 0) {
    return null;
  }

  return (
    <section>
      <h3>{title}</h3>
      <ul className="analysis-list">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  );
}

function isCorrectAnswer(userAnswer: string | undefined, correctAnswer: string) {
  return getAnswerLetter(userAnswer || "") === getAnswerLetter(correctAnswer);
}

function getQuizOptionClass(
  option: string,
  userAnswer: string,
  correctAnswer: string,
  submitted: boolean
) {
  const classes = ["quiz-option"];

  if (option === userAnswer) {
    classes.push("selected");
  }

  if (submitted && isCorrectAnswer(option, correctAnswer)) {
    classes.push("correct");
  }

  if (submitted && option === userAnswer && !isCorrectAnswer(option, correctAnswer)) {
    classes.push("wrong");
  }

  return classes.join(" ");
}

function getAnswerLetter(value: string) {
  return value.trim().match(/^[A-D]/i)?.[0].toUpperCase() || value.trim().toUpperCase();
}

function noteToChatContext(note: Note) {
  return [
    `Baslik: ${note.title}`,
    "",
    "Icerik:",
    note.content || "",
    "",
    note.summary ? `Ozet:\n${note.summary}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function documentAnalysisToText(analysis: DocumentAnalysis) {
  return [
    `Dosya: ${analysis.fileName}`,
    `Sayfa: ${analysis.pageCount}`,
    `Kelime: ${analysis.wordCount}`,
    "",
    `Ozet:\n${analysis.summary}`,
    "",
    `Onemli noktalar:\n${analysis.keyPoints.join("\n")}`,
    "",
    `Kritik bolumler:\n${analysis.importantSections.join("\n")}`,
    "",
    `Aksiyonlar:\n${analysis.actionItems.join("\n")}`,
  ].join("\n");
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export default App;
