import { Link, useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { useSandbox } from "@/lib/sandbox/sandboxStore";
import { PayerChip } from "@/components/sandbox/sandboxUi";
import { MoreHorizontal } from "lucide-react";

const statusLabel: Record<string, string> = {
  draft: "Entwurf",
  proposed: "Vorschlag",
  invoiced: "Abgerechnet",
};

export default function SandboxDokumentationenPage() {
  const navigate = useNavigate();
  const { state } = useSandbox();

  const sorted = [...state.documentations].sort((a, b) => (a.date < b.date ? 1 : -1));

  const invoiceForDoc = (docId: string) => state.invoices.find((i) => i.documentation_id === docId);

  return (
    <div className="space-y-5">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Dokumentationen</h1>
        </div>

      <div className="rounded-lg border border-border/80 bg-background shadow-sm overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[120px]">Datum</TableHead>
              <TableHead>Patient:in</TableHead>
              <TableHead className="min-w-[200px]">Versicherung</TableHead>
              <TableHead>Diagnose (Freitext)</TableHead>
              <TableHead className="w-[110px]">Status</TableHead>
              <TableHead className="w-[100px] text-right">Aktionen</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {sorted.map((doc) => {
              const patient = state.patients.find((p) => p.id === doc.patient_id);
              const inv = invoiceForDoc(doc.id);
              return (
                <TableRow key={doc.id}>
                  <TableCell className="tabular-nums text-muted-foreground">{doc.date}</TableCell>
                  <TableCell className="font-medium">{patient?.name ?? doc.patient_id}</TableCell>
                  <TableCell className="align-top">
                    {patient ? (
                      <div className="flex flex-col gap-1 items-start">
                        <PayerChip type={patient.insurance_type} />
                        <span className="text-xs text-muted-foreground leading-snug line-clamp-2">{patient.insurance_provider}</span>
                      </div>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="max-w-[280px] truncate text-muted-foreground">{doc.diagnosis_text}</TableCell>
                  <TableCell>
                    <Badge variant={doc.status === "draft" ? "secondary" : "outline"} className="font-normal">
                      {statusLabel[doc.status] ?? doc.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8" aria-label="Aktionen">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        {doc.status === "draft" && (
                          <DropdownMenuItem onClick={() => navigate(`/sandbox/analyse/${doc.id}`)}>
                            Rechnung erstellen
                          </DropdownMenuItem>
                        )}
                        {inv && (
                          <DropdownMenuItem asChild>
                            <Link to={`/sandbox/review/${inv.id}`}>Zur Review</Link>
                          </DropdownMenuItem>
                        )}
                        {!inv && doc.status !== "draft" && (
                          <DropdownMenuItem disabled>Keine offene Rechnung</DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
