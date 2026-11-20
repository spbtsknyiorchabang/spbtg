# SPBT G – Rekod Pinjaman Buku Teks

Web statik (HTML/CSS/JS, tanpa proses binaan) untuk guru mengisi pengagihan buku teks SPBT dan mencetak Borang SPBT G (Murid).
Data disimpan di Supabase. Tiada log masuk.

- `docs/` – laman web (diterbitkan melalui GitHub Pages)
- `supabase/schema.sql` – skema pangkalan data
- `docs/config.js` – URL dan kunci awam (anon) Supabase
- `docs/template.js` – susun atur borang SPBT G yang dijana daripada fail Excel asal (`tools/gen_template.py`)

Data murid tidak disimpan dalam repositori ini.
