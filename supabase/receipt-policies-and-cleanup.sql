-- 1. Enable update and delete policies for payment_receipts
drop policy if exists "members update payment receipts" on public.payment_receipts;
drop policy if exists "members delete payment receipts" on public.payment_receipts;

create policy "members update payment receipts" on public.payment_receipts
  for update to authenticated
  using (public.is_member(workspace_id))
  with check (public.is_member(workspace_id));

create policy "members delete payment receipts" on public.payment_receipts
  for delete to authenticated
  using (public.is_member(workspace_id));

-- 2. Delete the dummy/fake test receipts
delete from public.payment_receipts
where workspace_id = '17f39873-e10f-4bdf-93ee-1f92b3e25251'
  and (
    source_key in (
      'repair-paid:5da48f69-a01a-437e-8051-c2baa3e743ad',
      'repair-paid:8fb9d349-2287-44c6-b41d-5f516db2d116',
      'repair-paid:93a84f1f-727f-42e9-b64d-0f9d0f2f2355',
      'repair-paid:5e9be488-ed97-4b47-9116-7b5570b45f68',
      'repair-paid:f9fb87f3-85e9-4b17-a190-805a77b4ba25',
      'test:permission_check'
    )
    or client_name = 'Test Client'
  );

-- 3. Reload schema cache
notify pgrst, 'reload schema';
