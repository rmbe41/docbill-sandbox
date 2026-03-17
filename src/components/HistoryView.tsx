import { useState } from "react";
import { Trash2, Pencil, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/hooks/useConversations";
import { isToday, isYesterday } from "date-fns";

function groupByDate(conversations: Conversation[]) {
  const today: Conversation[] = [];
  const yesterday: Conversation[] = [];
  const earlier: Conversation[] = [];
  for (const c of conversations) {
    const d = new Date(c.updated_at);
    if (isToday(d)) today.push(c);
    else if (isYesterday(d)) yesterday.push(c);
    else earlier.push(c);
  }
  return { today, yesterday, earlier };
}

type Props = {
  conversations: Conversation[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
};

const HistoryView = ({
  conversations,
  activeId,
  onSelect,
  onDelete,
  onRename,
}: Props) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (conv: Conversation) => {
    setEditingId(conv.id);
    setEditValue(conv.title);
  };

  const saveEdit = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
    setEditValue("");
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditValue("");
  };

  const Section = ({ label, items }: { label: string; items: Conversation[] }) =>
    items.length === 0 ? null : (
      <div className="mb-8 last:mb-0">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/60 mb-3 pl-1">
          {label}
        </p>
        <div className="rounded-lg divide-y divide-border/50 bg-muted/10 dark:bg-muted/5">
          {items.map((conv) => (
            <div
              key={conv.id}
              className={cn(
                "group flex items-center gap-3 px-3 py-2.5 cursor-pointer text-sm transition-colors",
                activeId === conv.id
                  ? "bg-muted/80 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50 hover:text-foreground"
              )}
              onClick={() => editingId !== conv.id && onSelect(conv.id)}
            >
              <div className="flex-1 min-w-0">
                {editingId === conv.id ? (
                  <Input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onBlur={saveEdit}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") saveEdit();
                      if (e.key === "Escape") cancelEdit();
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="h-8 text-sm"
                    autoFocus
                  />
                ) : (
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{conv.title}</p>
                    {conv.source_filename && (
                      <p className="truncate text-xs text-muted-foreground/80 mt-0.5 flex items-center gap-1">
                        <FileText className="w-3 h-3 flex-shrink-0" />
                        {conv.source_filename}
                      </p>
                    )}
                  </div>
                )}
              </div>
              {editingId !== conv.id && (
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation();
                      startEdit(conv);
                    }}
                    title="Umbenennen"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 hover:bg-transparent"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(conv.id);
                    }}
                    title="Löschen"
                  >
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    );

  const { today, yesterday, earlier } = groupByDate(conversations);

  return (
    <div className="flex flex-col min-h-0">
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-2xl mx-auto px-4 py-6 pb-20">
          {conversations.length === 0 ? (
            <p className="text-sm text-muted-foreground/80 text-center py-12">
              Noch keine Chats
            </p>
          ) : (
            <>
              <Section label="Heute" items={today} />
              <Section label="Gestern" items={yesterday} />
              <Section label="Älter" items={earlier} />
            </>
          )}
        </div>
      </ScrollArea>
    </div>
  );
};

export default HistoryView;
