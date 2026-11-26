-- Clasificación online de Rallys en Supabase: una tabla con las mejores vueltas y sus fantasmas.
-- Se pega entera en Supabase → SQL Editor → «New query» → Run. Se puede ejecutar más de una vez.
--
-- Reglas (Row Level Security): con la clave pública «anon» cualquiera puede LEER la clasificación y AÑADIR vueltas,
-- pero nadie puede cambiar ni borrar las que hay. Los límites de abajo evitan nombres, tiempos o fantasmas absurdos.

create table if not exists public.vueltas (
  id           bigint generated always as identity primary key,
  creado       timestamptz not null default now(),
  escenario    text not null check (char_length(escenario) between 1 and 200),  -- id del circuito en el menú
  version      text not null check (char_length(version) between 1 and 40),     -- huella del trazado
  piloto       text not null check (char_length(btrim(piloto)) between 1 and 24),
  coche        text not null check (char_length(coche) between 1 and 80),
  coche_nombre text not null default '' check (char_length(coche_nombre) <= 80),
  tiempo       real not null check (tiempo > 20 and tiempo < 3600),             -- segundos de la vuelta
  fantasma     text not null check (char_length(fantasma) between 20 and 400000 and fantasma like 'R1:%')
);

create index if not exists vueltas_clasificacion on public.vueltas (escenario, version, tiempo);

-- Que la API (la clave pública) vea la tabla: solo leer y añadir. Hace falta en los proyectos creados sin «Conceda
-- acceso a la API a las nuevas tablas automáticamente»; en los demás no estorba.
grant usage on schema public to anon, authenticated;
revoke all on public.vueltas from anon, authenticated;
grant select, insert on public.vueltas to anon, authenticated;

alter table public.vueltas enable row level security;

drop policy if exists "leer la clasificación" on public.vueltas;
create policy "leer la clasificación" on public.vueltas for select to anon, authenticated using (true);

drop policy if exists "subir una vuelta" on public.vueltas;
create policy "subir una vuelta" on public.vueltas for insert to anon, authenticated with check (true);

-- (sin políticas de update ni delete: no se pueden cambiar ni borrar vueltas con la clave pública; tú sí puedes desde
-- el panel de Supabase, Table Editor)
