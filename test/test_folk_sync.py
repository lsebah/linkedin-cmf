# -*- coding: utf-8 -*-
"""Tests de folk_sync.py sur des fiches fictives. Lancer : python -m unittest discover -s test"""
import json
import os
import subprocess
import sys
import tempfile
import unittest
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))
import folk_sync as F  # noqa: E402

G = F.GROUPES
MAINTENANT = datetime(2026, 11, 16, 9, 0, tzinfo=timezone.utc)


def fiche(pid, nom, groupes=(), cfv=None, urls=(), statut=None, createur=F.LAURENT, nb=0, dernier=None, **extra):
    prenom, _, famille = nom.partition(" ")
    cfv = dict(cfv or {})
    if statut is not None or G["weekly"] in groupes:
        cfv.setdefault(G["weekly"], {"Status": statut})
    f = {
        "id": pid, "firstName": prenom, "lastName": famille, "fullName": nom, "description": "", "jobTitle": "",
        "createdAt": "2026-01-01T00:00:00.000Z", "createdBy": {"id": createur, "fullName": "Collègue Fictif"},
        "groups": [{"id": g} for g in groupes], "emails": [], "phones": [], "urls": list(urls), "customFieldValues": cfv,
        "interactionMetadata": {"workspace": {"approximateCount": nb, "lastInteractedAt": dernier, "lastInteractedBy": []}},
    }
    f.update(extra)
    return f


def ev(nom, type_, **extra):
    e = {"nom": nom, "type": type_, "categorie": "cgp", "famille": "dist", "version": "A1",
         "texte": "Bonjour Paul,\n...", "dateUTC": "2026-11-16T08:31:00Z", "slug": F.norm(nom).replace(" ", "-")}
    e.update(extra)
    return e


def ops(sortie, prefixe):
    return [o for o in sortie["operations"] if o["id"].startswith(prefixe)]


class Recherche(unittest.TestCase):
    def test_avec_et_sans_accents(self):
        o = F.ops_recherche([ev("Hélène Bézier", "premier"), ev("Paul Durand", "premier"), ev("Paul Durand", "relance1")])
        self.assertEqual(len(o), 3)
        self.assertTrue(all(x["method"] == "GET" for x in o))
        self.assertIn("H%C3%A9l%C3%A8ne%20B%C3%A9zier", o[0]["endpoint"])
        self.assertIn("Helene%20Bezier", o[1]["endpoint"])

    def test_dedoublonnage_par_slug_et_nom(self):
        a = fiche("per_a", "Helene Bezier", urls=["https://www.linkedin.com/in/helene-bezier/"])
        b = fiche("per_b", "Hélène Bézier")
        f, sig = F.trouver_fiche(ev("Hélène Bézier", "premier"), [a, b, a])
        self.assertEqual(f["id"], "per_a")
        homonyme = fiche("per_c", "Hélène Bézier", urls=["https://www.linkedin.com/in/une-autre-personne/"])
        f, sig = F.trouver_fiche(ev("Hélène Bézier", "premier"), [homonyme])
        self.assertIsNone(f)
        self.assertIn("homonyme", sig[0])


class Routage(unittest.TestCase):
    def test_creation_cgp(self):
        s = F.construire([ev("Paul Durand", "premier", poste="CGP", org="Cabinet Durand")], [], maintenant=MAINTENANT)
        c = ops(s, "creation")[0]["body"]
        self.assertEqual([g["id"] for g in c["groups"]], [G["cgp_france"], G["weekly"]])
        self.assertEqual(c["customFieldValues"][G["cgp_france"]], {"Déjà Couvert": ["Laurent"]})
        self.assertEqual(c["customFieldValues"][G["weekly"]], {"Status": "Lead"})
        self.assertEqual(c["urls"], ["https://www.linkedin.com/in/paul-durand/"])
        self.assertNotIn("emails", c)
        self.assertNotIn("phones", c)
        i = ops(s, "interaction")[0]["body"]
        self.assertEqual(i["entity"], {"id": "$ref:creation:0.id"})
        self.assertEqual(i["title"], "LinkedIn : prise de contact envoyée (A1)")
        self.assertEqual(i["dateTime"], "2026-11-16T08:31:00.000Z")
        self.assertEqual(i["type"], "linkedin")

    def test_creation_institutionnel(self):
        s = F.construire([ev("Anne Roy", "premier", categorie="mutuelle", famille="inst", version="AI2")], [], maintenant=MAINTENANT)
        c = ops(s, "creation")[0]["body"]
        self.assertEqual([g["id"] for g in c["groups"]], [G["the_list"], G["weekly"]])
        self.assertEqual(c["customFieldValues"][G["the_list"]],
                         {"Assign": [{"id": F.LAURENT}], "Acquisition": "LinkedIn", "Client Type": "Mutuelle"})

    def test_patch_renvoie_existant_plus_ajout(self):
        f = fiche("per_1", "Paul Durand", groupes=[G["dump"], G["cgp_france"]], urls=["https://exemple.fr"],
                  cfv={G["cgp_france"]: {"Déjà Couvert": [], "Potentiel": None}})
        s = F.construire([ev("Paul Durand", "premier")], [f], maintenant=MAINTENANT)
        b = ops(s, "maj")[0]["body"]
        self.assertEqual([g["id"] for g in b["groups"]], [G["dump"], G["cgp_france"], G["weekly"]])
        self.assertEqual(b["urls"], ["https://exemple.fr", "https://www.linkedin.com/in/paul-durand/"])
        self.assertEqual(b["customFieldValues"][G["cgp_france"]], {"Déjà Couvert": ["Laurent"]})
        self.assertEqual(b["customFieldValues"][G["weekly"]], {"Status": "Lead"})

    def test_assign_sans_retirer_les_autres(self):
        f = fiche("per_2", "Anne Roy", groupes=[G["the_list"], G["weekly"]],
                  cfv={G["the_list"]: {"Assign": [{"id": "usr_autre", "fullName": "X"}], "Acquisition": "Monitor", "Client Type": None}})
        s = F.construire([ev("Anne Roy", "relance1", categorie="fondation", famille="inst", version="BI1")], [f], maintenant=MAINTENANT)
        b = ops(s, "maj")[0]["body"]
        self.assertNotIn("groups", b)  # rien à ajouter : groupes non renvoyés
        tl = b["customFieldValues"][G["the_list"]]
        self.assertEqual(tl["Assign"], [{"id": "usr_autre"}, {"id": F.LAURENT}])
        self.assertNotIn("Acquisition", tl)  # déjà renseigné
        self.assertEqual(tl["Client Type"], "Asso / Diocese / Federation")
        self.assertEqual(ops(s, "interaction")[0]["body"]["title"], "LinkedIn : relance envoyée (BI1)")


class Statuts(unittest.TestCase):
    def test_jamais_de_descente(self):
        self.assertEqual(F.statut_final(None, "Lead", {}, MAINTENANT), "Lead")
        self.assertEqual(F.statut_final("Lead", "Follow-up", {}, MAINTENANT), "Follow-up")
        self.assertIsNone(F.statut_final("Qualified", "Follow-up", {}, MAINTENANT))
        self.assertIsNone(F.statut_final("Closed-won", "Lead", {}, MAINTENANT))
        self.assertEqual(F.statut_final("Qualified", "Closed-lost", {}, MAINTENANT), "Closed-lost")

    def test_closed_lost_dormant_apres_12_mois(self):
        recent = fiche("per_3", "A B", dernier="2026-06-01T00:00:00.000Z")
        ancien = fiche("per_4", "C D", dernier="2025-06-01T00:00:00.000Z")
        self.assertIsNone(F.statut_final("Closed-lost", "Follow-up", recent, MAINTENANT))
        self.assertEqual(F.statut_final("Closed-lost", "Follow-up", ancien, MAINTENANT), "Follow-up")
        self.assertIsNone(F.statut_final("Closed-lost", "Lead", ancien, MAINTENANT))

    def test_cloture_dormant(self):
        f = fiche("per_5", "Paul Durand", groupes=[G["cgp_france"], G["weekly"]], statut="Follow-up",
                  cfv={G["cgp_france"]: {"Déjà Couvert": ["Laurent"]}}, urls=["https://www.linkedin.com/in/paul-durand/"], jobTitle="CGP")
        s = F.construire([ev("Paul Durand", "cloture", version=None)], [f], maintenant=MAINTENANT)
        self.assertEqual(ops(s, "maj")[0]["body"], {"customFieldValues": {G["weekly"]: {"Status": "Closed-lost"}}})
        self.assertEqual(ops(s, "interaction"), [])


class Interactions(unittest.TestCase):
    def test_pas_de_doublon_meme_minute_meme_titre(self):
        f = fiche("per_6", "Paul Durand", groupes=[G["cgp_france"], G["weekly"]], statut="Lead",
                  cfv={G["cgp_france"]: {"Déjà Couvert": ["Laurent"]}}, urls=["https://www.linkedin.com/in/paul-durand/"], jobTitle="CGP")
        e = ev("Paul Durand", "relance1", version="B2", dateUTC="2026-11-16T08:31:40Z")
        e2 = dict(e, dateUTC="2026-11-16T08:31:05Z")
        s = F.construire([e, e2], [f], maintenant=MAINTENANT)
        self.assertEqual(len(ops(s, "interaction")), 1)
        s2 = F.construire([e], [f], journal=s["journal"], maintenant=MAINTENANT)
        self.assertEqual(len(ops(s2, "interaction")), 0)

    def test_titres_et_heure_utc(self):
        self.assertEqual(F.titre_interaction({"type": "relance2", "version": "E1"}), "LinkedIn : relance 2 envoyée (E1)")
        self.assertEqual(F.titre_interaction({"type": "backlog", "version": "B3"}), "LinkedIn : relance envoyée (B3)")
        self.assertEqual(F.titre_interaction({"type": "invitation"}), "LinkedIn : invitation envoyée")
        self.assertEqual(F.titre_interaction({"type": "reponse"}), "LinkedIn : réponse reçue")
        self.assertEqual(F.date_folk("2026-11-16T09:31:00+01:00"), "2026-11-16T08:31:00.000Z")
        with self.assertRaises(ValueError):
            F.date_folk("2026-11-16T09:31:00")

    def test_coordonnees_masquees(self):
        t = F.masquer("Écrivez-moi à paul@exemple.fr ou au 06 12 34 56 78, merci. 20 minutes, 2026-11-16.")
        self.assertNotIn("paul@exemple.fr", t)
        self.assertNotIn("06 12", t)
        self.assertIn("20 minutes, 2026-11-16", t)
        self.assertEqual(t.count(F.MASQUE), 2)

    def test_anniversaire_sans_ecriture(self):
        s = F.construire([ev("Paul Durand", "anniversaire", version="C")], [], maintenant=MAINTENANT)
        self.assertEqual(s["operations"], [])


class Sorties(unittest.TestCase):
    def test_refus(self):
        f = fiche("per_7", "Paul Durand", groupes=[G["the_list"], G["weekly"], G["cgp_france"]], description="Note existante",
                  cfv={G["cgp_france"]: {"Déjà Couvert": ["Laurent"]}})
        s = F.construire([ev("Paul Durand", "refus", motif="pas intéressé")], [f], maintenant=MAINTENANT)
        b = ops(s, "refus")[0]["body"]
        self.assertEqual(b["description"], "REFUS 2026-11-16 pas intéressé\nNote existante")
        self.assertEqual(b["groups"], [{"id": G["cgp_france"]}])
        self.assertEqual(b["customFieldValues"][G["cgp_france"]], {"Potentiel": "Refus", "Déjà Couvert": []})

    def test_fiche_d_un_collegue_avec_interactions(self):
        f = fiche("per_8", "Paul Durand", createur="usr_collegue", nb=3)
        s = F.construire([ev("Paul Durand", "premier")], [f], maintenant=MAINTENANT)
        self.assertEqual(s["operations"], [])
        self.assertIn("aucune écriture", s["signalements"][0])

    def test_deja_couvert_par_un_collegue(self):
        f = fiche("per_9", "Paul Durand", groupes=[G["cgp_france"]], cfv={G["cgp_france"]: {"Déjà Couvert": ["Mohamed"]}})
        s = F.construire([ev("Paul Durand", "premier")], [f], maintenant=MAINTENANT)
        self.assertEqual(s["operations"], [])


class LigneDeCommande(unittest.TestCase):
    def test_dry_run_par_defaut(self):
        script = os.path.join(os.path.dirname(__file__), "..", "src", "folk_sync.py")
        with tempfile.TemporaryDirectory() as d:
            pe, pf = os.path.join(d, "ev.json"), os.path.join(d, "fiches.json")
            with open(pe, "w", encoding="utf-8") as h:
                json.dump([ev("Paul Durand", "premier")], h)
            with open(pf, "w", encoding="utf-8") as h:
                json.dump({"data": {"items": []}}, h)
            base = [sys.executable, script, "plan", "--evenements", pe, "--fiches", pf]
            env = dict(os.environ, PYTHONIOENCODING="utf-8")
            a = json.loads(subprocess.run(base, capture_output=True, check=True, env=env).stdout.decode("utf-8"))
            b = json.loads(subprocess.run(base + ["--apply"], capture_output=True, check=True, env=env).stdout.decode("utf-8"))
        self.assertTrue(a["dryRun"])
        self.assertIn("avertissement", a)
        self.assertFalse(b["dryRun"])
        self.assertEqual(len(b["operations"]), 2)

    def test_aucun_appel_reseau_en_mode_plan(self):
        with open(os.path.join(os.path.dirname(__file__), "..", "src", "folk_sync.py"), encoding="utf-8") as h:
            src = h.read()
        for interdit in ("import requests", "urllib.request", "http.client", "socket", "api_key", "Authorization"):
            self.assertNotIn(interdit, src)


if __name__ == "__main__":
    unittest.main()
