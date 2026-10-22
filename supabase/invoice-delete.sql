drop policy if exists "members delete invoices" on public.invoices;
create policy "members delete invoices" on public.invoices for delete to authenticated using (public.is_member(workspace_id));
