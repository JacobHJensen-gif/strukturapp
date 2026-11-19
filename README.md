# Hverdagsro

Et lokalt udviklingsprojekt til en rolig dagsstruktur. Appen er **ikke produktionsklar** og må endnu ikke bruges til følsomme eller rigtige helbredsoplysninger.

## Status

Første fungerende grundlag omfatter invitationer, login, egne opgaver, rutiner, kalender, dagens energi, et enkelt fokusområde, timer, eksport af egne lokale data, lokale AI-forslag via en separat Ollama-model og krypterede offlineændringer med synkroniseringskø. Det er ikke en medicinsk behandling eller en sikkerhedskritisk påmindelsestjeneste. Energipoint er brugerens egne skøn og ikke kliniske målinger.

Følgende er **ikke implementeret eller ikke verificeret**: push- og lokale påmindelser, gennemført rutinehistorik, uafhængig pårørende- og administratoradgang, datadeling og samtykke, backup/gendannelse via appens brugerflade, fuld dagsplanlægning og aftenafslutning, færdiggørelsesstatistik, automatisk crashforebyggelse, GDPR-efterlevelse og en fuld WCAG 2.2 AA-revision. Appen er ikke testet på iPhone, iPad, Android eller Windows som installeret PWA. Service worker giver caching, men der er ikke en separat specialbygget splash screen.

En registreret bruger kan kun tilgå sine egne data. Nye konti kræver en engangsinvitation, der oprettes fra serverens kommandolinje; der findes endnu ingen roller eller administrationsgrænseflade. Login har en delt databasebaseret begrænsning på 10 forsøg pr. brugernavn pr. 15 minutter, men der kræves desuden trafikbegrænsning ved driftsmiljøets proxy. Der mangler bl.a. MFA, kontogendannelse, produktionshærdning og en database-migrationsløsning. SQLite er standard; PostgreSQL-driveren er medtaget, men PostgreSQL er ikke integrationstestet.

## Struktur

- `backend/app`: FastAPI, SQLAlchemy-modeller, Pydantic-skemaer og JWT.
- `backend/tests`: API-tests.
- `frontend/src`: React, skærme, offline-lager og synkronisering.
- `frontend/public`: appikoner.
- `compose.yaml`: lokal udviklingsopsætning med Docker.
- `.env.example`: konfigurationsskabelon uden hemmeligheder.

## Datamodel og API

Databasen indeholder `users` (brugernavn og Argon2-hash), `invitations` (hash af engangskoder), `auth_sessions` (sessioner og tilbagekaldelse), `login_throttles`, `items` (ejer, type, JSON-data, revision og slettemarkør), `operations` (kvitteringer til sikker genafsendelse af offlineændringer) og `audit_logs` (handlingstype og tidspunkt uden indholdet af aktiviteten). Opgaver, rutiner, kalenderaktiviteter og dagsregistreringer valideres hver for sig med Pydantic. En slettemarkør gør det muligt at synkronisere en sletning til andre enheder. Ved sletning fjernes indholdet logisk fra den aktive database og kendte kvitteringer, men det kan fortsat findes i backups eller underliggende lager. Ved versionskonflikt skal brugeren vælge, hvilken version der beholdes.

API'et tilbyder `POST /auth/register`, `POST /auth/login`, `POST /auth/logout`, `GET /items`, `POST /items/mutate`, `POST /suggestions` og `GET /health`. Dataendpoints kræver JWT og afgrænser data til den pågældende bruger. Logout tilbagekalder den aktuelle session på serveren. Den interaktive API-dokumentation findes på backendens `/docs` under lokal udvikling.

## Lokal installation på Windows

Kræver Python 3.12+ og Node.js 22.12 eller nyere. På denne computer ligger en lokal Node-version i `.tools/node`; den er ikke del af Git og erstatter ikke en global installation. Der er oprettet en lokal `.env` med en unik nøgle. Hvis den mangler på en anden maskine, kopieres `.env.example` til `.env`, og der indsættes en ny, hemmelig værdi i `SECRET_KEY`. Generér den eksempelvis med:

```powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

Gem ikke `.env` i Git, og del ikke nøglen. Åbn to PowerShell-vinduer:

```powershell
cd "C:\Users\JacobJørgensen\Projects\Hverdagsro"
python -m venv .venv
.\.venv\Scripts\python -m pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python -m uvicorn app.main:app --env-file ..\.env --host 127.0.0.1 --port 8000
```

```powershell
cd "C:\Users\JacobJørgensen\Projects\Hverdagsro\frontend"
$env:Path = "$(Resolve-Path ..\.tools\node);$env:Path"  # udelad, hvis Node er installeret globalt
npm install
npm run build
npm run preview
```

Åbn adressen, som Vite viser. Nye brugere skal have en invitation og en adgangskode på mindst 12 tegn. `DATABASE_URL` er relativ til backendens aktuelle arbejdsmappe ved lokal start. Se `examples/testdata.json` for eksempler, som kan oprettes manuelt; der oprettes ikke en fælles standardkonto.

### Invitationer

En betroet administrator med adgang til serverens kommandolinje kan oprette én invitation ad gangen. Fra `backend`:

```powershell
..\.venv\Scripts\python -m app.invite --env-file ..\.env --hours 24
```

Koden vises én gang, er gyldig i det valgte tidsrum og kan kun bruges én gang. Del den kun med den inviterede via en sikker kanal. Beskyt terminalhistorik, skærm og serveradgang; der er endnu ingen administrationsside eller tilbagekaldelse af ubrugte invitationer.

### Docker

Efter `.env` er oprettet:

```powershell
docker compose up --build
```

Åbn `http://localhost:8080`. SQLite-data gemmes i Docker-volumenet `hverdagsro_data`. Slet ikke volumenet, hvis data skal bevares. Docker-opsætningen er ikke afprøvet i dette miljø. Den er kun beregnet til lokal test; anvend ikke den indbyggede HTTP-opsætning som offentlig produktion.

## Lokal AI

På denne computer er den eksisterende lokale model `qwen2.5:3b` valgt i `.env`. Ollama skal køre på samme maskine som backend. På en anden maskine skal du selv installere Ollama og en model, sætte `LOCAL_AI_MODEL` i `.env` til modellens navn og genstarte backend. `LOCAL_AI_URL` skal pege på en lokal loopback-adresse. Data sendes ikke til en ekstern AI-tjeneste af denne integration. I Docker henviser loopback til containeren, ikke værten; integrationen kræver særskilt lokal konfiguration og virker ikke automatisk med en Ollama-instans på værten.

AI-forslag er kun forslag; kontrollér dem før brug. Systemet giver ikke medicinsk rådgivning.

## Offline og privatliv

Brug produktionsbuildet via `npm run preview` eller Docker til PWA-test; Vites udviklingsserver (`npm run dev`) installerer ikke service workeren. Log ind mindst én gang online, og lad appen hente sine filer og data, før forbindelsen afbrydes. Efter genindlæsning eller logout skal du indtaste brugernavn og adgangskode igen; vælg **Åbn offline**, hvis serveren ikke kan nås. Ændringer gemmes lokalt og sendes, når forbindelsen vender tilbage. Ved en konflikt mellem enheder stopper synkroniseringen og beder dig vælge version; ændringer overskrives ikke automatisk. Hvis sessionen er udløbet eller tilbagekaldt, skal du logge ind online igen for at synkronisere.

Offlineposter, kø og det gemte login-token krypteres med AES-GCM; nøglen udledes lokalt af adgangskoden med PBKDF2. En lang, unik adgangskode er nødvendig. Appen skal være indlæst i en sikker browserkontekst, dvs. HTTPS eller localhost. Krypteringen beskytter ikke mod malware, en kompromitteret app eller nogen, der har adgang til en allerede oplåst enhed. Krypter også enhed og serverdisk, beskyt nøgler og adgang, og lad en uafhængig ekspert gennemgå løsningen.

Ved første online-login efter opdateringen flyttes den pågældende kontos tidligere lokale poster og kø til krypteret lager. Luk andre åbne Hverdagsro-faner først. Ældre konti på samme enhed skal hver især logge ind for at blive flyttet. Gamle poster fjernes logisk fra browserlageret efter flytning; fysisk sletning af tidligere ukrypterede kopier kan ikke garanteres. Hvis adgangskoden ændres eller glemmes, kan tidligere offline-data og usynkroniserede ændringer ikke nødvendigvis låses op: synkronisér først og bevar den gamle adgangskode. Eksport og SQLite-backup er fortsat ukrypterede. Log ud sletter ikke offline-data. Hvis logout sker uden forbindelse, kan sessionen fortsat være gyldig på serveren indtil udløb.

## Lokal SQLite-backup

Når du kører backend lokalt fra `backend`, kan du oprette en konsistent kopi af standarddatabasen med:

```powershell
..\.venv\Scripts\python -m app.backup --database .\data\hverdagsro.db --output ..\backups\hverdagsro-backup.db
```

Vælg et nyt filnavn hver gang: eksisterende filer overskrives ikke. Backuppen indeholder alle SQLite-brugere og deres data, men ikke usynkroniserede ændringer på andre enheder, `.env`, programfiler eller en PostgreSQL-database. Filen er ikke krypteret og skal beskyttes. Gendannelse og en samlet katastrofeplan er endnu ikke afprøvet.

## Tests

```powershell
cd backend
..\.venv\Scripts\python -m pytest -q
cd ..\frontend
npm test
npm run build
```

Før drift med rigtige helbredsoplysninger skal der bl.a. vælges og konfigureres en server med HTTPS, kryptering af databasen og backups i hvile, nøglehåndtering, overvågning og trafikbegrænsning; en gendannelse skal afprøves. Løsningen skal sikkerhedstestes uafhængigt, rettigheder og sletning færdiggøres, juridisk databeskyttelse vurderes, og tilgængelighed testes på mål-enheder. Der skal også etableres database-migrationer. Disse krav er ikke opfyldt af den lokale testopsætning.

Den seneste `npm audit --omit=dev` fandt ingen kendte problemer i runtime-afhængighederne. Den fulde `npm audit` fandt fire moderate advarsler i buildafhængighederne omkring `glob`/`minimatch` og Workbox. Følg op på opdateringer og gennemgå buildmiljøet før drift; en tvungen opgradering eller nedgradering kan ændre PWA-buildets adfærd.

Ved seneste npm-audit var der ingen advisories i runtime-afhængighederne, men fire moderate advisories i udviklings-/buildværktøjernes afhængighedskæde. Disse er ikke afklaret og skal håndteres før produktion.
