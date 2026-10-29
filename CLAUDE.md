# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/hub.test.js              # one file
node --test --test-name-pattern "radon"   # tests whose name matches
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store --skip-image-check .   # store admission checks
node scripts/probe.mjs                    # real Airthings API, read-only (needs Internet)
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        registers every SDK handler on the hub (shared with the tests)
src/hub.js                        the account: reading cycle, own timer, onPoll fallback, publishing
src/airthings/client.js           Consumer API client: token, account, pages, quota, error kinds
src/airthings/http.js             the only network call (fetch, timeout), the tests' seam
src/airthings/model.js            API answers → records: sensor types, units, product names
src/devices.js                    Gladys device and features of a sensor, feature names (4 languages)
src/levels.js                     good / fair / poor thresholds (radon reference, Airthings apps)
src/widgets.js                    `air_quality` dashboard widget
src/texts.js                      connection status, errors, test report (4 languages)
src/store.js                      /data/airthings-state.json: token, account id, features seen
src/issues.js                     repeated failures logged once
src/config.js                     DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
scripts/probe.mjs                 read-only probe of the real API, prints nothing sensitive
gladys-assistant-integration.json manifest: name, config_schema, actions, widget, image...
docs/{en,fr,de,es}.md             user documentation, re-hosted by Gladys (same sections)
test/                             node --test, SDK's fake Gladys + in-memory Airthings cloud
test/fixtures/airthings/          API answers (origin in its README), anonymized
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **External ids are forever.** Build them with
  `gladys.externalIds(type, platformId)`, `platformId` being the unique id the
  platform gives the device (serial, cloud id, MAC), never a label. Gladys keys
  devices, their history, scenes and dashboards on them: changing one creates a
  new device and orphans the old one. The same goes for every key users store:
  manifest `config_schema`, `actions`, widget and scene keys, feature keys.
- **The container rootfs is read-only.** Write only under `/data`, the one
  writable volume. Never log tokens, passwords or API keys.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand — except on the README's hand-pushed tag path, which bumps all three
  together before tagging. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section, and it
  becomes the notes of the GitHub Release.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`:
  `label`, `description` and `placeholder` alike, never a plain string. The
  catalog `description` holds 10 to 100 characters per language. A field the
  older cores do not know needs a higher `gladys_version` minimum
  (`categories`: 4.86.0; `widgets`, `scene_triggers`, `scene_actions`,
  `type: "provider"`: 5.1.0). `test/manifest.test.js` ties the manifest to the
  code (defaults, action, scene and widget handlers): change both sides
  together.
- **User-facing text** exists in English, French, German and Spanish: action
  messages, widget texts, feature names, manifest texts, and `docs/en.md`,
  `docs/fr.md`, `docs/de.md`, `docs/es.md`, kept in sync (same sections).
  German says "du", Spanish "usted". `test/i18n.test.js` checks it.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.

---

# Notes du mainteneur (guim31)

Ce qui suit complète les règles du template ci-dessus. Ce sont des faits vérifiés dans le code du
cœur Gladys ou payés sur les intégrations déjà publiées par guim31. Ils ne se lisent pas dans le
code de ce dépôt. Compléter ce fichier quand un nouveau piège est découvert.

## Travailler sur ce dépôt

- Mêmes étapes que la CI, dans le même ordre : `npm ci`, `npm run format:check`, `npm run lint`,
  `npm test`. Prettier contrôle **aussi le Markdown** : lancer `npm run format` après avoir
  modifié ce fichier, le README ou la documentation, sinon la CI tombe.
- Une session de code n'a **ni instance Gladys ni appareil réel**. La suite de tests, le lint et
  le validateur du store sont les seules vérifications possibles : le test réel se fait ailleurs.
  Le dire, plutôt que de conclure que « ça marche ».
- **Tout le code de démonstration du template disparaît** : station météo, prise, lampe, caméra,
  capteur de mouvement, `src/weather.js`, leurs tests, leurs entrées du manifeste et de la
  documentation. Il ne reste que ce que l'intégration fait vraiment.
- **Publier n'est jamais le travail d'une session de code** : ni Release, ni tag, ni topic, ni
  version modifiée à la main. L'orchestrateur s'en charge une fois la PR fusionnée. Les workflows
  sont ceux du template : ne pas les modifier.
- Le dépôt est **public** : aucun secret, aucune adresse ni détail d'infrastructure privée, ni
  ici, ni dans les tests, ni dans les captures.

## Pièges du cœur Gladys

**Appareils et fonctionnalités**

- **Polling** : le planificateur n'interroge un appareil que si `should_poll: true` **et**
  `poll_frequency` vaut une valeur de la liste fixe, **en millisecondes** (1000, 2000, 10000,
  15000, 30000, 60000). Le template publie `poll_frequency: 300` sans `should_poll` : c'est faux,
  le cœur répond 400 à la découverte. Pour une cadence hors liste, publier `should_poll: false` et
  pousser les états depuis le conteneur, en gardant un `onPoll` de repli.
  **Piège du 5.2.0** (GladysAssistant/Gladys#3198, correctif #3199, relevé sur gladys-ping-wol) :
  un appareil **créé sans `should_poll`** n'est jamais sondé, même après correction du cœur (valeur
  stockée à la création), et la 5.2.1 du 13/10/2026 ne le corrige pas. **Le conteneur sonde donc
  lui-même** par un minuteur, qui saute un appareil sondé il y a moins d'une demi-période, en gardant
  `onPoll` comme repli ; seuls les appareils ajoutés (`gladys.devices`) sont lus. Un test le prouve
  sans appeler `onPoll`.
- **`min` et `max` sont NOT NULL** dans `t_device_feature`, y compris pour `text/text` : sans eux,
  « Ajouter à Gladys » échoue en HTTP 422. Mettre 0/0, comme Zigbee2MQTT.
- Un état publié sur une fonctionnalité **pas encore ajoutée** dans Gladys reçoit un 200 puis est
  jeté (simple ligne de log) : republier les états dans `onDeviceCreated`.
- `level-sensor/decimal` n'existe pas côté serveur. `light-sensor/binary` n'a pas de libellé dans
  le front (pastille vide) : préférer `input/binary`. Un `text/text` reçoit `{ text }`, jamais
  vide, sinon l'état est ignoré.
- **Le front nomme une ligne d'après l'appareil, pas la fonctionnalité, quand aucune autre
  fonctionnalité de l'appareil n'a le même _type_** (`shouldDisplayDeviceName` de
  `front/src/utils/device.js`, v5.2.1, qui compare le type seul, pas la catégorie) : un radon seul
  `integer` à côté de mesures `decimal` s'affiche « Salon 45 Bq/m³ », et les listes d'édition
  montrent le libellé générique du couple. Choisir les types pour que chacun soit partagé par au
  moins deux fonctionnalités de l'appareil, et le vérifier dans `test/gladys-rules.test.js`
  (relevé sur gladys-airthings, 15/10/2026).
- Pas de catégorie radon ni PM1 dans le cœur (5.2.1) ; l'unité `becquerel-per-cubic-meter`
  existe (Matter), affichée « Bq/m³ ». `light-sensor/integer` n'a pas d'icône dans la table :
  préférer `light-sensor/decimal`. Le cœur accepte n'importe quel couple catégorie/type/unité
  connu (`setDiscoveredDevices` ne contrôle pas leur association) : c'est la table du front qui
  décide de l'affichage. Les couleurs des pastilles (`BadgeNumberDeviceValue.jsx`) suivent la
  catégorie : CO₂ 600/1200 ppm, COV 250/2000 ppb, PM2.5 15/25 µg/m³, AQI 50…300.
- **Détecteur d'ouverture (`opening-sensor`) : 0 = ouvert, 1 = fermé** (`OPENING_SENSOR_STATE`), à
  l'inverse de l'intuition et des autres détecteurs (mouvement, fuite, fumée : 1 = détecté). Une
  porte ouverte publiée à 1 s'affiche « Fermé » et fausse scènes et historique. Le figer par un test.
- **Un `external_id` de fonctionnalité ne change jamais d'appareil** d'une version à l'autre. UniFi
  1.5.2 avait sorti les ports PoE dans un appareil dédié, la 1.6.0 les a remis dans la passerelle avec
  les mêmes identifiants : ceux qui avaient ajouté l'appareil dédié ne peuvent plus « Mettre à jour » la
  passerelle (409 `external_id must be unique`). Pour regrouper, garder l'appareil existant
  (`gladys.getDevices()`) ou changer d'identifiant.
- Les **noms de fonctionnalités sont figés à la création**. Et quand une fonctionnalité est seule
  de son type sur l'appareil, le tableau de bord affiche le libellé générique du type à la place
  du nom publié.
- **Aucune commande d'appareil ne permet un choix multiple** : un `text/select` n'a qu'un choix
  actif.
- Un changement de structure fait proposer « Mettre à jour » dans l'onglet Découverte
  (`structure_changed`). Un changement des seules `supported_options` ne le déclenche pas.
- **Jauge** : l'aiguille se place par `(value - min) / (max - min)` des bornes de la
  fonctionnalité. `gauge_min`/`gauge_max` ne pilotent que les couleurs, et le cœur n'applique
  jamais `min`/`max` en écriture : ce sont des bornes d'affichage. Une valeur signée exige des
  bornes symétriques.
- Le cœur plafonne à **300 états par minute** et réévalue les scènes à chaque état : ne publier
  que les changements.
- Une intégration `device` ne reçoit pas la langue de l'utilisateur, une action de scène non
  plus (un widget, si) : prévoir un champ de config `language` si des textes partent du
  conteneur. Le superviseur injecte `TZ`, le fuseau de Gladys. La sandbox est limitée à 256 Mo.

**Formulaires de configuration et actions**

- Les champs `number` sont rendus **sans `step`** : le navigateur n'accepte alors que `min + k`.
  Min et défaut **entiers** seulement ; une valeur décimale passe par un `select` ou par un
  `string` parsé (virgule acceptée).
- Un champ `secret` dans les `fields` d'une **action** est impossible à remplir, et une action
  n'applique **aucun `default`** tout en exigeant les champs `required` (422). Issues
  GladysAssistant/Gladys#3154 et #3155.

**SDK 0.15 et journaux**

- SDK `@gladysassistant/integration-sdk` **^0.15.0** (12/10/2026) : `DEVICE_POLL_FREQUENCIES`, faux
  Gladys de test (`@gladysassistant/integration-sdk/testing`, à préférer à un faux maison),
  déduplication des états, `parseMdnsTxt`. Lire son README et son CHANGELOG.
- **Journaux calmes** (demande de Guilhem, 13/10/2026) : rien au niveau info pour un cycle normal de
  lecture, un état publié ou un message reçu. L'info ne garde que le cycle de vie : démarrage,
  connexion, perte et retour d'un appareil ou d'un service, erreurs utiles, une ligne par action de
  l'utilisateur. Le reste passe en debug (`LOG_LEVEL=debug`). Une erreur qui se répète écrit une ligne
  au premier échec et une au rétablissement, pas une par tentative. Jamais de secret ni d'adresse
  avec identifiants. Un test vérifie qu'un cycle normal n'écrit rien en info.
- **Heartbeat** : republier au moins toutes les 12 h une valeur qui ne change pas, sinon le front
  affiche « Pas de valeur récente » au-delà de 48 h.

**Widgets, déclencheurs, actions de scène (SDK ≥ 0.14, Gladys ≥ 5.1)**

- **Cibler la dernière version publiée du cœur, pas `master`** : la spec de `master` décrit des
  fonctions non publiées. Les boutons de widget qui ouvrent un formulaire (#3168, commit 3feb2cf8)
  sont absents de la 5.1.4 mais **livrés dans la 5.2.0** (sortie le 12/10/2026) : `gladys_version`
  `>=5.2.0` si on s'en sert, ou un bouton direct en repli. Vérifier par `git tag --contains`.

- Un réglage de widget ne propose en liste que les **appareils** de l'intégration
  (`source: "devices"`, seule source dynamique).
- Budget du cœur : **8 composants par widget, dont 2 textes au plus**, appliqué **avant** la
  résolution des références ; un contenu amputé reste en cache jusqu'au TTL. Appeler
  `requestWidgetRefresh` à la création d'un appareil. `validateWidgetContent` est exporté pour les
  tests, mais ne vérifie pas que les `external_id` liés existent : les croiser avec `buildDevice`.
- Une ligne de `status` exige un `value` (nombre ou texte ≤ 40).
- Le cœur **jette un bouton dont la clé d'action est déjà prise** : clés numérotées.
- Le vocabulaire des widgets n'a ni liste ni curseur, **par choix** du cœur. Seul un bouton
  `device_feature` numérique a un état actif natif.
- **En mode sombre, le style `primary` d'un bouton de widget ne se voit pas** (#3153) : signaler
  un choix courant par l'icône (`check-circle`), jamais par le style.
- Dans une grille `card-list`, la `date` s'affiche **à la place** du sous-titre.
- `onWidgetAction` fait recharger le widget dès la résolution, alors que `requestWidgetRefresh`
  est plafonné à un appel toutes les 10 s. Un toast d'action est tronqué à 200 caractères.
- Le cœur met le contenu d'un widget en cache par (réglages, langue, unités) : pré-localiser
  d'après `language` est correct.
- Les filtres de scène ne font qu'égalité et appartenance : un seuil reste le travail d'un capteur.
- **Les clés de widgets, de déclencheurs et d'actions sont figées une fois publiées.**
- `gladys_version` `>=5.1.0` dès qu'il y a widgets, déclencheurs ou actions de scène.

**SDK, faux Gladys**

- `gladys.fake.transports` est déjà aplati : des entrées `{ device_external_id, transport }`, pas
  le corps `{ external_id, transport }` envoyé.
- Le `CHANGELOG.md` du template cite `` `## [Unreleased]` `` dans son introduction : un script
  qui cherche la première occurrence coupe le fichier au mauvais endroit (`test/release.test.js`
  le voit).

## Store

- Validateur officiel, depuis la racine : `npx -y github:GladysAssistant/integration-store .`
  (schéma, `description` **100 caractères au plus par langue**, documentation de 300 caractères
  au moins, image Docker, cover de **150 Ko au plus**). Il demande Node ≥ 24 mais tourne sous
  Node 22 avec un avertissement.
- L'indexeur lit le manifeste de la **dernière release**, pas celui de `main` : une correction du
  manifeste (catégorie, description…) n'atteint le store qu'avec une release.
- L'indexeur rejette **en silence** : la raison n'apparaît que dans `rejected.json`, à côté de
  `https://integration-store-storage.gladysassistant.com/index.json`.
- **Image de base** : `FROM mirror.gcr.io/library/node:…` (miroir Docker Hub de Google, même
  empreinte, sans compte) et non `node:…` de Docker Hub ni `public.ecr.aws/docker/library/node:…`
  d'ECR Public : tous deux refusent en 429 les pulls anonymes des runners GitHub dès qu'il y a
  plusieurs builds à la fois (ECR depuis fin octobre 2026). Un échec 429 dans le job « Docker build »
  n'est pas un bug du code. Même parade dans `.github/workflows/build.yml` (posée par
  l'orchestrateur, ne pas la retirer) : QEMU et BuildKit tirés de `mirror.gcr.io`.
- La règle `data/` du `.gitignore` du template (pour le volume `/data`) exclut aussi `src/data/` :
  l'ancrer en `/data/`, dans `.prettierignore` aussi.

### Langues (depuis le 11/10/2026)

Tout texte montré à l'utilisateur existe en **`en`, `fr`, `de` et `es`** : manifeste, contenu des widgets, messages,
noms de fonctionnalités. L'allemand **tutoie** (« du »), l'espagnol **vouvoie** (« usted ») : décision de Guilhem,
appliquée à ses 21 intégrations. `test/i18n.test.js` doit échouer sur une langue manquante, un texte vide ou trop
long, et sur un « Sie »/« Ihr… » de politesse en allemand. Le store exige `docs/en.md` et `docs/fr.md`
(`DOCS_LANGUAGES`) et publie aussi `docs/de.md` et `docs/es.md` quand ils existent
(`DOCS_OPTIONAL_LANGUAGES` d'integration-store) : écrire les quatre, avec les mêmes sections.

## Choix par défaut de Guilhem (12/10/2026)

- Langue par défaut des noms de fonctionnalités et des textes produits par le conteneur : **`fr`**.
- Fichier `LICENSE` Apache-2.0 (texte complet) à la racine.
- `transports` : `local` seul quand le cloud n'est qu'une option annexe.
- Docs `en`, `fr`, `de`, `es` avec les mêmes sections.
- Chauffe, ouverture, sécurité : ne rien rendre pilotable « comme un thermostat » ou par un assistant
  vocal quand une erreur serait dangereuse (leçon d'OctoPrint).

## Intégration Airthings

- **API** : Airthings Consumer API (`consumer-api.airthings.com/v1`), spécification OpenAPI
  vendorisée dans `michaelahern/airthings-consumer-api` (`vendor-docs/openapi.yaml`, ISC). Jeton
  par `POST accounts-api.airthings.com/v1/token`, identifiants en HTTP Basic et corps JSON
  `{ grant_type: 'client_credentials' }` (forme de ce client, en production dans
  homebridge-airthings). Puis `/accounts` (id constant pour un compte grand public), `/devices`,
  `/sensors?unit=metric` (50 appareils par page, `hasNext`/`totalPages`). L'ancienne API
  `ext-api.airthings.com` de pyAirthings et de Home Assistant n'est pas utilisée.
- **Quota : 120 requêtes par heure** et par client d'API (un client par compte). Une relève =
  une requête pour tout le compte ; liste des appareils une fois par heure ; budget propre de 100
  requêtes sur une heure glissante ; un 429 suspend tout jusqu'à `X-RateLimit-Retry-After`
  (secondes ou horodatage, les deux sont lus), borné entre 1 min et 1 h. Jeton et id de compte
  dans `/data` : un redémarrage ne coûte aucune requête. Des identifiants refusés ne sont réessayés
  que toutes les 30 min.
- **Unités** de la réponse : `bq`, `c`, `pct`, `mbar`, `ppm`, `ppb`, `mgpc` (= µg/m³ malgré le nom),
  `lux`, `dba` ; en impérial `pci`, `f`, `pa`. Une unité inconnue écarte la valeur (un
  avertissement). `recorded` arrive sans fuseau (`2025-01-01T12:34:56`) : lu en UTC, **non
  vérifié**.
- Un Wave Enhance annonce `sla` et `lux` dans `/devices` sans les envoyer
  (home-assistant/core#140845) : les fonctionnalités suivent la première relève, pas la liste
  annoncée, et sont mémorisées dans `/data`.
- **Couples** : radon `counter-sensor/integer` en Bq/m³, PM1 `pm25-sensor/decimal`, CO₂
  `co2-sensor/decimal` ; l'âge de la mesure (`duration`, minutes) prend le type `integer` quand
  une seule autre fonctionnalité entière existe (`ageType`), pour qu'aucun type ne soit seul.
- Pas de déclencheur ni d'action de scène : seuils radon, CO₂, batterie et âge de la mesure sont
  couverts par les déclencheurs natifs sur l'état des appareils.
- Non vérifié faute de compte et de réseau : forme exacte de la requête de jeton, types et unités
  de chaque modèle, fuseau de `recorded`, en-têtes d'un vrai 429. `scripts/probe.mjs` les éprouve.
- Le proxy des sessions refuse `*.airthings.com` et `consumer-api-doc.airthings.com` : travailler sur
  les fixtures de `test/fixtures/airthings/`.
