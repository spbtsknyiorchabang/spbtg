-- Skema pangkalan data SPBT G (Supabase / PostgreSQL). Jadual berawalan spbt_ supaya tidak bertembung dengan jadual lain.
create table public.spbt_tetapan (kunci text primary key, nilai text not null default '');
create table public.spbt_guru (id uuid primary key default gen_random_uuid(), nama text not null unique);
create table public.spbt_buku (
  id uuid primary key default gen_random_uuid(), tahun int not null check (tahun between 1 and 6),
  kod text not null, judul text not null, pesanan int, susunan int not null default 0, unique (tahun, kod));
create table public.spbt_kelas (
  id uuid primary key default gen_random_uuid(), tahun int not null check (tahun between 1 and 6), nama text not null,
  guru_kelas text not null default '', penolong text not null default '', tarikh_agih date,
  buku_ids jsonb not null default '[]'::jsonb, susunan int not null default 0, dikemaskini timestamptz not null default now());
create table public.spbt_murid (
  id uuid primary key default gen_random_uuid(), kelas_id uuid not null references public.spbt_kelas(id) on delete cascade,
  susunan int not null default 0, nama text not null, jantina text not null default '',
  nota text not null default '', tarikh_terima date, tarikh_pulang date);
create index on public.spbt_murid(kelas_id);
create table public.spbt_terima (
  murid_id uuid not null references public.spbt_murid(id) on delete cascade,
  buku_id uuid not null references public.spbt_buku(id) on delete cascade,
  status text not null check (status in ('T','X')), primary key (murid_id, buku_id));

create or replace function public.spbt_simpan_kelas(p jsonb) returns void language plpgsql as $$
declare k jsonb := p->'kelas'; m jsonb; t jsonb; kid uuid := (p->'kelas'->>'id')::uuid;
begin
  update public.spbt_kelas set nama = k->>'nama', guru_kelas = coalesce(k->>'guru_kelas',''), penolong = coalesce(k->>'penolong',''),
    tarikh_agih = nullif(k->>'tarikh_agih','')::date, buku_ids = coalesce(k->'buku_ids','[]'::jsonb), dikemaskini = now() where id = kid;
  delete from public.spbt_murid where kelas_id = kid and id not in (select (x->>'id')::uuid from jsonb_array_elements(p->'murid') x);
  for m in select * from jsonb_array_elements(p->'murid') loop
    insert into public.spbt_murid(id,kelas_id,susunan,nama,jantina,nota,tarikh_terima,tarikh_pulang)
    values ((m->>'id')::uuid, kid, (m->>'susunan')::int, m->>'nama', coalesce(m->>'jantina',''),
      coalesce(m->>'nota',''), nullif(m->>'tarikh_terima','')::date, nullif(m->>'tarikh_pulang','')::date)
    on conflict (id) do update set kelas_id=excluded.kelas_id, susunan=excluded.susunan, nama=excluded.nama,
      jantina=excluded.jantina, nota=excluded.nota, tarikh_terima=excluded.tarikh_terima, tarikh_pulang=excluded.tarikh_pulang;
  end loop;
  delete from public.spbt_terima where murid_id in (select id from public.spbt_murid where kelas_id = kid);
  for t in select * from jsonb_array_elements(coalesce(p->'terima','[]'::jsonb)) loop
    insert into public.spbt_terima(murid_id,buku_id,status) values ((t->>'m')::uuid,(t->>'b')::uuid,t->>'s');
  end loop;
end $$;

-- Akses terbuka tanpa log masuk (sengaja: semua guru boleh sunting).
do $$ declare t text; begin
  foreach t in array array['spbt_tetapan','spbt_guru','spbt_buku','spbt_kelas','spbt_murid','spbt_terima'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy "akses_terbuka" on public.%I for all to anon, authenticated using (true) with check (true)', t);
  end loop;
end $$;
