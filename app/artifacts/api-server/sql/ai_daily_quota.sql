-- Apply manually in the Supabase SQL editor before deploying the API routes
-- that call consume_ai_daily_quota. This migration is intentionally not run
-- by the application.

create table if not exists public.ai_daily_usage (
  user_id uuid not null references public.profiles(id) on delete cascade,
  usage_day date not null default current_date,
  request_count integer not null default 0 check (request_count >= 0),
  reserved_output_tokens integer not null default 0 check (reserved_output_tokens >= 0),
  primary key (user_id, usage_day)
);

alter table public.ai_daily_usage enable row level security;
revoke all on public.ai_daily_usage from public, anon, authenticated;

create or replace function public.consume_ai_daily_quota(
  p_user_id uuid,
  p_scope text,
  p_request_limit integer,
  p_output_token_limit integer,
  p_reserved_output_tokens integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_request_count integer;
  v_reserved_output_tokens integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;
  if p_user_id is null
     or p_scope not in ('oracle_chat', 'strategy_brief', 'multi_timeframe')
     or p_request_limit < 1
     or p_output_token_limit < 1
     or p_reserved_output_tokens < 1 then
    raise exception 'invalid AI quota request' using errcode = '22023';
  end if;

  insert into public.ai_daily_usage as usage (
    user_id,
    usage_day,
    request_count,
    reserved_output_tokens
  )
  values (p_user_id, current_date, 1, p_reserved_output_tokens)
  on conflict (user_id, usage_day) do update
    set request_count = usage.request_count + 1,
        reserved_output_tokens = usage.reserved_output_tokens + p_reserved_output_tokens
    where usage.request_count + 1 <= p_request_limit
      and usage.reserved_output_tokens + p_reserved_output_tokens <= p_output_token_limit
  returning request_count, reserved_output_tokens
    into v_request_count, v_reserved_output_tokens;

  if not found then
    return jsonb_build_object('allowed', false);
  end if;

  return jsonb_build_object(
    'allowed', true,
    'scope', p_scope,
    'request_count', v_request_count,
    'reserved_output_tokens', v_reserved_output_tokens
  );
end;
$$;

revoke all on function public.consume_ai_daily_quota(uuid, text, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_ai_daily_quota(uuid, text, integer, integer, integer)
  to service_role;