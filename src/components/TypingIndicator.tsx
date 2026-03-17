import DocBillLogo from "@/assets/DocBill-Logo.svg";

const TypingIndicator = () => {
  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex-shrink-0 w-8 h-8 rounded-full overflow-hidden mt-1">
        <img src={DocBillLogo} alt="DocBill" className="w-8 h-8" />
      </div>
      <div className="chat-bubble-assistant rounded-2xl rounded-bl-md px-4 py-3">
        <div className="flex gap-1.5 items-center h-5">
          <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse-dot" style={{ animationDelay: "0ms" }} />
          <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse-dot" style={{ animationDelay: "200ms" }} />
          <span className="w-2 h-2 rounded-full bg-muted-foreground/60 animate-pulse-dot" style={{ animationDelay: "400ms" }} />
        </div>
      </div>
    </div>
  );
};

export default TypingIndicator;
