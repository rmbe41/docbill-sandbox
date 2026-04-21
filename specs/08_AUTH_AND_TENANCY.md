# DocBill Spec – 08 Auth & Multi-Tenancy

> Teil der modularen Spezifikation v1.3. Siehe `00_INDEX.md` für Gesamtübersicht.
> Cross-Referenzen: → `05_KNOWLEDGE_BASE.md` (Datenisolierung Wissensbasis), → `03_UI_UX.md` (Feedback-Dashboard Zugang)

---

---

## 13. User & Account Management (Multi-Tenancy)

### 13.1 Datenmodell

DocBill ist mandantenfähig. Mehrere Firmen (Praxen, MVZ, Abrechnungsdienste) können das System nutzen. Jede Firma hat mehrere Nutzer.

```typescript
interface Organisation {
  id: string;
  name: string;
  typ: 'einzelpraxis' | 'gemeinschaftspraxis' | 'mvz' | 'abrechnungsdienst' | 'klinik';
  plan: 'free' | 'pro' | 'enterprise';
  ssoConfig?: SSOConfig;
  settings: OrganisationSettings;
  createdAt: string;
}

interface SSOConfig {
  provider: 'oidc' | 'saml';
  issuer: string;
  clientId: string;
  // Secrets werden verschlüsselt in Vault gespeichert
}

interface User {
  id: string;
  organisationId: string;
  email: string;
  name: string;
  rolle: UserRolle;
  fachgebiet?: string;
  lastLoginAt: string;
  isActive: boolean;
}

type UserRolle = 'admin' | 'manager' | 'viewer';

interface OrganisationSettings {
  defaultRegelwerk: 'GOAE' | 'EBM';
  defaultFachgebiet?: string;
  customWissensbasis: boolean;
  batchLimit: number;
  datenschutzModus: 'standard' | 'streng';
}
```

### 13.2 Rollenkonzept

| Rolle | Rechte |
|-------|--------|
| Admin | Alles: Nutzerverwaltung, Einstellungen, Wissens-Updates, Billing |
| Manager | Alle Modi, Batch, Export, Feedback-Dashboard |
| Viewer | Nur Lesen von Analysen und Rechnungen, kein Erstellen |

### 13.3 Auth-Flow

SSO ist der primäre Auth-Mechanismus. Für Organisationen ohne SSO gibt es E-Mail + Passwort als Fallback.

```
1. Nutzer öffnet DocBill
2. Organisation wird erkannt (via Subdomain oder E-Mail-Domain)
3. Falls SSO konfiguriert: Redirect zu IdP → OIDC/SAML-Flow → Token → Session
4. Falls kein SSO: E-Mail + Passwort → JWT → Session
5. Session-Dauer: 8h, Refresh-Token: 30 Tage
```

### 13.4 Datenisolierung

Jede Organisation sieht nur ihre eigenen Daten (Row-Level Security in PostgreSQL). Rechnungen, Analysen, Batches, Feedback und Sessions sind organisationsgebunden. Die globale Wissensbasis (GOÄ-JSON, EBM-JSON, BÄK-Beschlüsse) wird geteilt; organisationsspezifische Wissens-Uploads (Kommentarliteratur etc.) sind nur für die jeweilige Organisation sichtbar.

