-- Structured payloads (assistant invoice/service + user attachments) and client-mergeable fields
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS structured_content jsonb NULL;

CREATE POLICY "Users can update own messages" ON public.messages
  FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.conversations c
      WHERE c.id = messages.conversation_id AND c.user_id = auth.uid()
    )
  );
