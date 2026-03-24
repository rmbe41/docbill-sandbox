import { ScrollArea } from "@/components/ui/scroll-area";
import HistoryPanel, { type HistoryPanelProps } from "@/components/HistoryPanel";

type Props = Omit<HistoryPanelProps, "layout">;

const HistoryView = (props: Props) => {
  return (
    <div className="flex flex-col min-h-0">
      <ScrollArea className="flex-1 min-h-0">
        <div className="max-w-2xl mx-auto px-4 py-6 pb-20">
          <HistoryPanel {...props} layout="page" />
        </div>
      </ScrollArea>
    </div>
  );
};

export default HistoryView;
