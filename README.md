# INJECTOR — Cookie Injection Panel

## Setup Railway

### 1. Variabili d'ambiente (Railway → Variables)

| Variabile | Valore |
|---|---|
| `ADMIN_USER` | tuo username admin |
| `ADMIN_PASS` | tua password sicura |
| `SESSION_SECRET` | stringa random lunga (es. uuid) |
| `RAILWAY_VOLUME_MOUNT_PATH` | `/data` |
| `PORT` | lascia vuoto (Railway lo imposta) |

### 2. Volume (Railway → Volumes)
- Mount path: `/data`
- Serve per persistere keys, cookies, URL tra restart

### 3. Deploy
```bash
# da locale con Railway CLI
railway login
railway init
railway up
```

oppure collega il repo GitHub direttamente da Railway dashboard.

---

## Come funziona

### Admin Panel (`/`)
- Login con `ADMIN_USER` / `ADMIN_PASS`
- **Sito Target** — URL del sito dove vuoi iniettare i cookies (cambia quando vuoi)
- **Cookies** — incolla la cookie string (`name=value; name2=value2`) o JSON array
- **Genera Key** — genera 1-100 key per i clienti
- **Sessioni** — vedi chi ha riscattato e quando

### Area Clienti (`/` → "Area Clienti")
- Il cliente inserisce la sua key
- Il sistema genera un link `/inject?token=...` univoco
- Il cliente clicca il link → viene reindirizzato al sito con i cookies iniettati

### Injection flow
`/inject?token=TOKEN` → verifica token → legge cookies dal DB → serve pagina HTML che imposta i cookies e redirect al sito target

---

## Note tecniche

- Storage: JSON file su volume Railway (`/data/db.json`)
- Sessioni admin: express-session in memoria (si resetta al restart — normale)
- Token: UUID v4 concatenati (128 char hex)
- Keys: formato `XXXXXXXX-XXXXXXXX-XXXXXXXX-XXXXXXXX` (Base32 senza ambigui)
