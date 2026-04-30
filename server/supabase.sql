alter table notes
  add column if not exists summary text,
  add column if not exists tags text[] default '{}',
  add column if not exists quiz jsonb;

create index if not exists notes_title_content_search_idx
  on notes using gin (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(content, ''))
  );

create index if not exists notes_tags_idx
  on notes using gin (tags);
