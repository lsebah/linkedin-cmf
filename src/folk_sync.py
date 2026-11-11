#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
folk_sync.py : dédoublonnage, routage et interactions Folk en lot (prompt v8, section Routage Folk).

Pas de clé API Folk : tout passe par Composio (toolkit `folk`).

Mode plan (par défaut, aucun appel réseau) : le script produit un JSON d'opérations Folk
(méthode, endpoint, body) que la routine exécute une à une avec COMPOSIO_PROXY_EXECUTE.

    python folk_sync.py recherche --evenements ev.json                 # opérations GET de recherche
    python folk_sync.py plan --evenements ev.json --fiches fiches.json # opérations d'écriture (dry-run)
    python folk_sync.py plan --evenements ev.json --fiches fiches.json --apply

Sans --apply (dry-run, par défaut), la sortie porte "dryRun": true : elle montre ce qui serait écrit
et ne doit pas être exécutée.

Mode atelier (COMPOSIO_REMOTE_WORKBENCH) : coller ce fichier dans une cellule puis appeler
    sync_atelier(evenements, proxy_execute, apply=False)
`proxy_execute` est la fonction fournie par l'atelier ; vérifié en lecture le 2026-11-11.

Aucune coordonnée (email, téléphone) n'est écrite, sauf celles données par le contact lui-même
(événement de type "reponse" avec le champ "coordonnees").
"""
import argparse
import json
import re
import sys
import unicodedata
from datetime import datetime, timedelta, timezone
from urllib.parse import quote

VERSION = "9.0.2"
API = "https://api.folk.app/v1"

LAURENT = "usr_97d36c92-4487-4b45-8a90-3982aec9e0ea"
GROUPES = {
    "the_list": "grp_9ab5b27f-2161-4dfb-a00e-ada0888efb29",
    "weekly": "grp_a2fc0f5f-96c5-4e25-bc86-d47f2881c581",
    "linkedin": "grp_15301c3d-745b-4261-9836-14dbdb243009",  # inaccessible à l'API depuis le 2026-11-03 : jamais écrit
    "cgp_france": "grp_96f7ad3a-0a8a-4fcf-af02-a7ee534d85cd",
    "dump": "grp_704d8f89-4279-4c86-917e-d3802d8c120b",
}

# Client Type (The List) selon la catégorie : valeurs existantes dans Folk, relevées le 2026-11-11.
CLIENT_TYPE = {
    "family_office": "Family Office + HNW",
    "banque_privee": "Banque Privée",
    "mutuelle": "Mutuelle",
    "prevoyance": "Institutionnel",
    "association": "Asso / Diocese / Federation",
    "fondation": "Asso / Diocese / Federation",
    "corporate": "Corporate",
}

# Rang des statuts : jamais de descente, sauf vers Closed-lost.
RANG = {None: 0, "": 0, "Lead": 1, "Follow-up": 2, "Qualified": 3, "Closed-won": 4}

TITRES = {
    "premier": "prise de contact envoyée",
    "backlog": "prise de contact envoyée",
    "relance1": "relance envoyée",
    "relance2": "relance 2 envoyée",
    "invitation": "invitation envoyée",
    "reponse": "réponse reçue",
}
STATUT_CIBLE = {
    "premier": "Lead", "backlog": "Lead", "invitation_acceptee": "Lead",
    "relance1": "Follow-up", "relance2": "Follow-up", "cloture": "Closed-lost", "refus": "Closed-lost",
}

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
TEL_RE = re.compile(r"(?<![\w/=-])(?:\+|00)?\d(?:[\s.\-]?\d){8,13}(?![\w/=-])")
MASQUE = "[coordonnées dans la conversation LinkedIn]"


# ---------- Utilitaires ----------

def sans_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", s or "") if unicodedata.category(c) != "Mn")


def norm(s):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", sans_accents(s).lower())).strip()


def slug_de(url):
    m = re.search(r"linkedin\.com/in/([^/?#\s]+)", url or "", re.I)
    return m.group(1).lower() if m else None


def url_linkedin(slug):
    return "https://www.linkedin.com/in/%s/" % slug


def masquer(texte):
    """Remplace emails et téléphones du texte par la mention convenue."""
    t = EMAIL_RE.sub(MASQUE, texte or "")
    return TEL_RE.sub(MASQUE, t)


def date_folk(date_utc):
    """AAAA-MM-JJTHH:MM:SS.000Z à partir d'une date ISO en UTC (heure réelle d'envoi)."""
    s = (date_utc or "").strip()
    if not s:
        raise ValueError("dateUTC absente : l'heure réelle d'envoi en UTC est obligatoire")
    if s.endswith("Z"):
        s = s[:-1] + "+00:00"
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", s):
        s += ":00"
    d = datetime.fromisoformat(s)
    if d.tzinfo is None:
        raise ValueError("dateUTC sans fuseau : %s" % date_utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def est_cgp(ev):
    return (ev.get("categorie") or "") == "cgp"


def titre_interaction(ev):
    t = ev.get("type")
    version = ev.get("version")
    base = TITRES.get(t)
    if t == "backlog" and version and version.startswith("B"):
        base = TITRES["relance1"]
    if not base:
        return None
    titre = "LinkedIn : " + base
    if version and t not in ("invitation", "reponse"):
        titre += " (%s)" % version
    return titre


# ---------- Recherche et dédoublonnage ----------

def ops_recherche(evenements):
    """Opérations GET : recherche par nom complet, avec et sans accents."""
    ops, vus = [], set()
    for ev in evenements:
        nom = (ev.get("nom") or "").strip()
        if not nom or ev.get("type") == "anniversaire":
            continue
        for variante in dict.fromkeys([nom, sans_accents(nom)]):
            cle = variante.lower()
            if cle in vus:
                continue
            vus.add(cle)
            ops.append({
                "id": "recherche:%s" % norm(variante).replace(" ", "-") + ("" if variante == nom else ":sans-accents"),
                "method": "GET",
                "endpoint": "%s/people?limit=20&filter%%5BfullName%%5D%%5Blike%%5D=%s" % (API, quote(variante)),
                "pour": nom,
            })
    return ops


def trouver_fiche(ev, fiches):
    """
    Renvoie (fiche | None, signalements). `fiches` = liste de personnes Folk (résultats de recherche cumulés).
    Correspondance : slug LinkedIn identique, sinon nom complet normalisé identique.
    """
    signalements = []
    slug = (ev.get("slug") or "").lower() or None
    cible = norm(ev.get("nom"))
    uniques = {}
    for f in fiches:
        if f.get("id"):
            uniques[f["id"]] = f
    par_slug, par_nom = [], []
    for f in uniques.values():
        slugs = [slug_de(u) for u in f.get("urls") or []]
        if slug and slug in slugs:
            par_slug.append(f)
        elif cible and norm(f.get("fullName") or "%s %s" % (f.get("firstName") or "", f.get("lastName") or "")) == cible:
            # Même nom mais un autre profil LinkedIn : homonyme, pas la même personne.
            autres = [s for s in slugs if s]
            if slug and autres:
                signalements.append("homonyme ignoré : %s (%s)" % (f.get("fullName"), f["id"]))
                continue
            par_nom.append(f)
    candidats = par_slug or par_nom
    if not candidats:
        return None, signalements
    if len(candidats) > 1:
        candidats.sort(key=lambda f: f.get("createdAt") or "")
        signalements.append("doublon Folk : %s" % ", ".join(f["id"] for f in candidats))
    return candidats[0], signalements


# ---------- Construction des opérations ----------

def _groupes_ids(fiche):
    return [g["id"] for g in (fiche or {}).get("groups") or []]


def _cfv(fiche, groupe):
    return ((fiche or {}).get("customFieldValues") or {}).get(groupe) or {}


def _plus_de_12_mois(fiche, maintenant):
    dernier = (((fiche or {}).get("interactionMetadata") or {}).get("workspace") or {}).get("lastInteractedAt")
    if not dernier:
        return True
    d = datetime.fromisoformat(dernier.replace("Z", "+00:00"))
    return d < maintenant - timedelta(days=366)


def statut_final(actuel, cible, fiche, maintenant):
    """Jamais de descente, sauf vers Closed-lost ; Closed-lost dormant peut repasser en Follow-up après 12 mois."""
    if not cible or cible == actuel:
        return None
    if cible == "Closed-lost":
        return cible
    if actuel == "Closed-lost":
        return cible if cible == "Follow-up" and _plus_de_12_mois(fiche, maintenant) else None
    return cible if RANG.get(cible, 0) > RANG.get(actuel, 0) else None


def construire(evenements, fiches, journal=None, maintenant=None):
    """
    Renvoie { operations, signalements, journal, resume }.
    evenements : liste d'envois confirmés ou de réponses (voir README, « Événements Folk »).
    fiches     : personnes Folk trouvées par les recherches.
    journal    : clés d'interactions déjà créées (« per_id|AAAA-MM-JJTHH:MM|titre »), pour éviter les doublons.
    """
    maintenant = maintenant or datetime.now(timezone.utc)
    journal = set(journal or [])
    ops, signalements, nouveau_journal = [], [], []
    resume = {"creations": 0, "modifications": 0, "interactions": 0, "ignores": 0}
    fiches = list(fiches or [])
    crees = {}  # nom normalisé -> référence de la création dans ce lot

    for i, ev in enumerate(evenements):
        t = ev.get("type")
        nom = (ev.get("nom") or "").strip()
        if t == "anniversaire":
            continue  # pas d'interaction Folk, pas de changement de statut
        if not nom:
            signalements.append("événement %d sans nom : ignoré" % i)
            resume["ignores"] += 1
            continue

        fiche, sig = trouver_fiche(ev, fiches)
        signalements.extend("%s : %s" % (nom, s) for s in sig)
        ref = crees.get(norm(nom))
        cgp = est_cgp(ev)
        g_metier = GROUPES["cgp_france"] if cgp else GROUPES["the_list"]

        # Fiche d'un collègue avec des interactions : ne pas écrire, signaler.
        if fiche and (fiche.get("createdBy") or {}).get("id") not in (None, LAURENT):
            nb = (((fiche.get("interactionMetadata") or {}).get("workspace") or {}).get("approximateCount")) or 0
            par_laurent = any(u.get("id") == LAURENT for u in (((fiche.get("interactionMetadata") or {}).get("workspace") or {}).get("lastInteractedBy") or []))
            if nb > 0 and not par_laurent:
                signalements.append("%s : fiche créée par %s avec %d interactions, aucune écriture" % (
                    nom, (fiche.get("createdBy") or {}).get("fullName") or "un collègue", nb))
                resume["ignores"] += 1
                continue

        couvert = [c for c in (_cfv(fiche, GROUPES["cgp_france"]).get("Déjà Couvert") or []) if c != "Laurent"]
        if couvert and t not in ("reponse", "refus"):
            signalements.append("%s : déjà couvert par %s, aucune écriture" % (nom, ", ".join(couvert)))
            resume["ignores"] += 1
            continue

        cible = ev.get("statut") if t == "reponse" else STATUT_CIBLE.get(t)
        entite = None

        if t == "refus":
            if not fiche:
                signalements.append("%s : refus sans fiche Folk, rien à écrire" % nom)
                continue
            jour = date_folk(ev.get("dateUTC"))[:10]
            desc = "REFUS %s %s" % (jour, (ev.get("motif") or "").strip())
            existant = fiche.get("description") or ""
            body = {
                "description": (desc.strip() + ("\n" + existant if existant else "")),
                "groups": [{"id": GROUPES["cgp_france"]}],
                "customFieldValues": {GROUPES["cgp_france"]: {
                    "Potentiel": "Refus",
                    "Déjà Couvert": [c for c in (_cfv(fiche, GROUPES["cgp_france"]).get("Déjà Couvert") or []) if c != "Laurent"],
                }},
            }
            ops.append({"id": "refus:%d" % i, "method": "PATCH", "endpoint": "%s/people/%s" % (API, fiche["id"]), "body": body, "pour": nom})
            resume["modifications"] += 1
            continue

        if t == "ecarte":
            if fiche:
                jour = date_folk(ev.get("dateUTC"))[:10]
                existant = fiche.get("description") or ""
                ligne = "ÉCARTÉ %s %s" % (jour, (ev.get("motif") or "").strip())
                if not existant.startswith("ÉCARTÉ "):
                    ops.append({"id": "ecarte:%d" % i, "method": "PATCH", "endpoint": "%s/people/%s" % (API, fiche["id"]),
                                "body": {"description": ligne.strip() + ("\n" + existant if existant else "")}, "pour": nom})
                    resume["modifications"] += 1
            continue

        if not fiche and not ref:
            # Création selon le routage.
            prenom = (ev.get("prenom") or nom.split(" ")[0]).strip()
            famille_nom = (ev.get("nomFamille") or " ".join(nom.split(" ")[1:])).strip()
            cfv = {}
            if cgp:
                cfv[GROUPES["cgp_france"]] = {"Déjà Couvert": ["Laurent"]}
            else:
                champs = {"Assign": [{"id": LAURENT}], "Acquisition": "LinkedIn"}
                ct = CLIENT_TYPE.get(ev.get("categorie") or "")
                if ct:
                    champs["Client Type"] = ct
                else:
                    signalements.append("%s : Client Type non déterminé (catégorie « %s »), laissé vide" % (nom, ev.get("categorie")))
                cfv[GROUPES["the_list"]] = champs
            if cible:
                cfv[GROUPES["weekly"]] = {"Status": cible}
            body = {
                "firstName": prenom, "lastName": famille_nom,
                "groups": [{"id": g_metier}, {"id": GROUPES["weekly"]}],
                "customFieldValues": cfv,
            }
            poste = ", ".join(x for x in [ev.get("poste"), ev.get("org")] if x)
            if poste:
                body["jobTitle"] = poste
            if ev.get("slug"):
                body["urls"] = [url_linkedin(ev["slug"])]
            op_id = "creation:%d" % i
            ops.append({"id": op_id, "method": "POST", "endpoint": "%s/people" % API, "body": body, "pour": nom})
            resume["creations"] += 1
            ref = crees[norm(nom)] = "$ref:%s.id" % op_id
            entite = ref
        elif fiche:
            entite = fiche["id"]
            body = {}
            ids = _groupes_ids(fiche)
            manquants = [g for g in (g_metier, GROUPES["weekly"]) if g not in ids]
            if manquants:
                body["groups"] = [{"id": g} for g in ids + manquants]  # l'existant plus l'ajout : le PATCH remplace
            urls = list(fiche.get("urls") or [])
            if ev.get("slug") and ev["slug"].lower() not in [slug_de(u) for u in urls]:
                body["urls"] = urls + [url_linkedin(ev["slug"])]
            if not (fiche.get("jobTitle") or "").strip():
                poste = ", ".join(x for x in [ev.get("poste"), ev.get("org")] if x)
                if poste:
                    body["jobTitle"] = poste
            cfv = {}
            if cgp:
                actuel = _cfv(fiche, GROUPES["cgp_france"])
                if not (actuel.get("Déjà Couvert") or []) and actuel.get("Potentiel") != "Refus":
                    cfv[GROUPES["cgp_france"]] = {"Déjà Couvert": ["Laurent"]}
            else:
                actuel = _cfv(fiche, GROUPES["the_list"])
                champs = {}
                assign = [{"id": u.get("id")} for u in actuel.get("Assign") or [] if u.get("id")]
                if LAURENT not in [a["id"] for a in assign]:
                    champs["Assign"] = assign + [{"id": LAURENT}]  # sans retirer les autres
                if not actuel.get("Acquisition"):
                    champs["Acquisition"] = "LinkedIn"
                if not actuel.get("Client Type"):
                    ct = CLIENT_TYPE.get(ev.get("categorie") or "")
                    if ct:
                        champs["Client Type"] = ct
                    else:
                        signalements.append("%s : Client Type vide et non déterminé, laissé vide" % nom)
                if champs:
                    cfv[GROUPES["the_list"]] = champs
            nouveau = statut_final(_cfv(fiche, GROUPES["weekly"]).get("Status"), cible, fiche, maintenant)
            if nouveau:
                cfv[GROUPES["weekly"]] = {"Status": nouveau}
            elif cible and cible != _cfv(fiche, GROUPES["weekly"]).get("Status"):
                signalements.append("%s : statut %s conservé (pas de descente vers %s)" % (nom, _cfv(fiche, GROUPES["weekly"]).get("Status"), cible))
            if cfv:
                body["customFieldValues"] = cfv
            if t == "reponse" and ev.get("coordonnees"):
                # Seul cas où l'on écrit des coordonnées : données par le contact lui-même.
                coord = ev["coordonnees"]
                if coord.get("emails"):
                    body["emails"] = list(dict.fromkeys((fiche.get("emails") or []) + coord["emails"]))
                if coord.get("phones"):
                    body["phones"] = list(dict.fromkeys((fiche.get("phones") or []) + coord["phones"]))
            if body:
                ops.append({"id": "maj:%d" % i, "method": "PATCH", "endpoint": "%s/people/%s" % (API, fiche["id"]), "body": body, "pour": nom})
                resume["modifications"] += 1
        else:
            entite = ref

        titre = titre_interaction(ev)
        if titre and entite:
            quand = date_folk(ev.get("dateUTC"))
            cle = "%s|%s|%s" % (entite, quand[:16], titre)
            if cle in journal:
                signalements.append("%s : interaction déjà créée (%s), ignorée" % (nom, titre))
                continue
            journal.add(cle)
            nouveau_journal.append(cle)
            contenu = masquer(ev.get("texte") or "")
            if t == "reponse" and ev.get("apercu"):
                contenu = "(aperçu) " + contenu
            if t == "invitation" and not contenu:
                contenu = "Invitation LinkedIn envoyée sans note."
            ops.append({"id": "interaction:%d" % i, "method": "POST", "endpoint": "%s/interactions" % API, "pour": nom,
                        "body": {"entity": {"id": entite}, "type": "linkedin", "dateTime": quand, "title": titre, "content": contenu}})
            resume["interactions"] += 1

    return {"operations": ops, "signalements": signalements, "journal": nouveau_journal, "resume": resume}


# ---------- Mode atelier (Composio) ----------

def _items(res):
    d = res.get("data") if hasattr(res, "get") else None
    while isinstance(d, dict) and "items" not in d and isinstance(d.get("data"), dict):
        d = d["data"]
    return (d or {}).get("items") or []


def sync_atelier(evenements, proxy_execute, apply=False, journal=None):
    """
    À appeler dans COMPOSIO_REMOTE_WORKBENCH. Recherche les fiches, construit les opérations et,
    si apply=True, les exécute une à une. Une écriture en erreur n'est jamais rejouée automatiquement
    (les 502 de Folk sont ponctuels : vérifier avant de rejouer).
    """
    fiches = []
    for op in ops_recherche(evenements):
        res, err = proxy_execute("GET", op["endpoint"], "folk")
        if err:
            raise RuntimeError("recherche Folk en échec : %s" % err)
        fiches.extend(_items(res))
    sortie = construire(evenements, fiches, journal=journal)
    sortie["dryRun"] = not apply
    if not apply:
        return sortie
    refs, resultats = {}, []
    for op in sortie["operations"]:
        body = json.loads(json.dumps(op.get("body")), object_hook=lambda o: {
            k: (refs.get(v[5:-3], v) if isinstance(v, str) and v.startswith("$ref:") else v) for k, v in o.items()})
        res, err = proxy_execute(op["method"], op["endpoint"], "folk", body=body)
        ok = not err
        if ok and op["id"].startswith("creation:"):
            d = res.get("data") if hasattr(res, "get") else {}
            while isinstance(d, dict) and "id" not in d and isinstance(d.get("data"), dict):
                d = d["data"]
            refs[op["id"]] = (d or {}).get("id")
        resultats.append({"id": op["id"], "ok": ok, "erreur": err or None})
    sortie["resultats"] = resultats
    return sortie


# ---------- Ligne de commande ----------

def _lire(chemin):
    with open(chemin, encoding="utf-8") as f:
        return json.load(f)


def _aplatir_fiches(brut):
    """Accepte une liste de personnes, un dictionnaire { requête: [personnes] } ou des réponses d'API brutes."""
    out = []

    def visiter(o):
        if isinstance(o, dict):
            if "id" in o and str(o["id"]).startswith("per_"):
                out.append(o)
            else:
                for v in o.values():
                    visiter(v)
        elif isinstance(o, list):
            for v in o:
                visiter(v)
    visiter(brut)
    return out


def main(argv=None):
    p = argparse.ArgumentParser(description="Synchronisation Folk en lot (mode plan : aucun appel réseau).")
    sp = p.add_subparsers(dest="commande", required=True)
    r = sp.add_parser("recherche", help="opérations GET de recherche des fiches")
    r.add_argument("--evenements", required=True)
    w = sp.add_parser("plan", help="opérations d'écriture (dry-run par défaut)")
    w.add_argument("--evenements", required=True)
    w.add_argument("--fiches", required=True)
    w.add_argument("--journal")
    w.add_argument("--dry-run", dest="dry_run", action="store_true", default=True, help="par défaut : n'émet rien d'exécutable")
    w.add_argument("--apply", dest="dry_run", action="store_false", help="émet les opérations à exécuter")
    a = p.parse_args(argv)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    evenements = _lire(a.evenements)
    if a.commande == "recherche":
        sortie = {"version": VERSION, "operations": ops_recherche(evenements)}
    else:
        journal = _lire(a.journal) if a.journal else []
        sortie = construire(evenements, _aplatir_fiches(_lire(a.fiches)), journal=journal)
        sortie = dict({"version": VERSION, "dryRun": a.dry_run}, **sortie)
        if a.dry_run:
            sortie["avertissement"] = "dry-run : ne pas exécuter ces opérations ; relancer avec --apply"
    json.dump(sortie, sys.stdout, ensure_ascii=False, indent=2)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
