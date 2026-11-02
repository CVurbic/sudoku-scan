# Sudoku Scan

## Bilješke i dnevnik

Bilješke projekta su u `notes/` (na hrvatskom, samo lokalno: `notes/` je u `.gitignore`, nikad se ne commita).

- **Na početku sesije** pročitaj `notes/README.md` (odjeljci "Stanje", "Gdje smo stali", "Za sljedeći put") i najnoviju datoteku u `notes/dnevnik/`. Starije dane čitaj samo kad zatreba.
- **Dnevnik:** mapa `notes/dnevnik/`, jedna datoteka po danu, ime `GGGG-MM-DD.md` (npr. `2026-11-02.md`), naslov `# Dnevnik GGGG-MM-DD`. Unutar dana odjeljci `## Tema` redom kako se radi. Upisuj **tijekom rada**, odmah nakon svakog gotovog koraka: što je napravljeno (datoteke, funkcije), što je zapelo i zašto, popravci, odluke s razlozima, rezultati testova i mjerenja, commitovi. Novi dan = nova datoteka; ne prepisuj stare dane.
- **`notes/README.md` "Stanje"** je trenutna slika: prepiši ga (s datumom) nakon svakog većeg koraka, ne dodaji na kraj. **"Za sljedeći put"** drži ažurnim prije pauze.
- Ostalo: `zadaci.md` (otvoreni zadaci), `odluke.md`, `napravljeno.md`, `tehnicko.md`, `mockups/` (HTML mockupi).

## Način rada

- Veći posao ide dio po dio; za svaki novi UI dio prvo statični mockup u `notes/mockups/`: varijante kao kartice (tipke 1, 2, 3…), opcije kao gumbi (npr. Desktop/Mobitel, tema), jedna-dvije rečenice opisa. Chris bira, tek onda ugradnja.
- Dizajn uz skillove `emil-design-eng` i `design-taste-frontend`.
- Prije commita: `node test.js` mora dati `ALL OK`, i snimke ekrana (desktop i mobitel) pregledane.
