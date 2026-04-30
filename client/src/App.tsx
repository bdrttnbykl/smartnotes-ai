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
    } catch (err) {
      setError(err instanceof Error ? err.message : "Beklenmeyen hata");
    } finally {
      setBusyNoteId(null);
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
                  <section className="quiz">
                    <h3>Quiz</h3>
                    {note.quiz.map((item, index) => (
                      <div className="quiz-item" key={`${note.id}-${index}`}>
                        <strong>
                          {index + 1}. {item.question}
                        </strong>
                        <ul>
                          {item.options.map((option) => (
                            <li key={option}>{option}</li>
                          ))}
                        </ul>
                        <p>Cevap: {item.answer}</p>
                        {item.explanation && <p>{item.explanation}</p>}
                      </div>
                    ))}
                  </section>
                )}
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}

function parseTags(value: string) {
  return value
    .split(",")
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

export default App;
