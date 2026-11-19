# Glossar

Die festen Wörter der Oberfläche. Ein Ding hat genau einen Namen, überall. Neue Texte benutzen diese Wörter; steht hier ein „nicht“, kommt das Wort in der Oberfläche nicht vor.

## Dinge

| Wort               | Bedeutung                                                                                                                   | nicht                           |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Rahmen             | Ein Bilderrahmen an der Wand. Hat einen Ortsnamen („Flur“) und klein darunter Gerätename und IP.                            | Display, Gerät, Frame           |
| Bild               | Ein Foto oder Kunstwerk in der Bibliothek.                                                                                  | Foto, Asset, Motiv              |
| Kombiniertes Bild  | Ein neues Bild aus 2 bis 4 Bildern. Eigene Karte im Stapel.                                                                 | Doppelbild, Collage, Paar       |
| Bibliothek         | Alle übernommenen Bilder.                                                                                                   | Pool, Galerie                   |
| Eingang            | Wo neue Bilder zuerst landen, bis man sie übernimmt.                                                                        | Inbox, Posteingang              |
| Album              | Ein Etikett für Bilder. Ein Bild kann in mehreren Alben sein.                                                               | Tag, Ordner                     |
| Gruppe             | Mehrere Rahmen mit einem gemeinsamen Thema. Jeder Rahmen ist in genau einer.                                                | Zone, Raum                      |
| Thema              | Die Alben einer Gruppe.                                                                                                     | Filter, Quelle                  |
| Stapel             | Die gemischten Bilder einer Gruppe, je Format einer. Rahmen ziehen von oben.                                                | Deck, Playlist, Warteschlange   |
| Runde              | Einmal durch den Stapel. Danach wird neu gemischt.                                                                          | Zyklus                          |
| Vorrat             | Bilder, die schon am Rahmen liegen (1 bis 5 zusätzlich zum aktuellen).                                                      | Puffer, Buffer, Slots           |
| Zeitplan           | Was ein Rahmen oder ein Stapel als Nächstes zeigt.                                                                          | Timeline, Playlist              |
| Kunst              | Der Bereich für gemeinfreie Werke aus dem Katalog. Nur da, wenn der Kunstkatalog eingeschaltet ist.                         | Galerie, Art                    |
| Kunstkatalog       | Die Sammlung gemeinfreier Werke (paperlesspaper), ein Schalter in den Einstellungen.                                        | Museum, Katalogmodus            |
| Kunstwerk / Werk   | Ein Bild aus dem Kunstkatalog. Behält Künstler, Jahr, Sammlung und Lizenz.                                                  | Gemälde, Artwork                |
| Sammlung           | Woher ein Werk stammt: Wikimedia Commons, Metropolitan Museum of Art, Art Institute of Chicago.                             | Quelle (das ist die Bildquelle) |
| Kunst untermischen | Je Gruppe: jedes 3., 5. oder 10. Bild der Stapel ist ein Kunstwerk. Aus „Meine Kunstwerke“ oder der „Auswahl des Katalogs“. | Kunstmodus, Rotation            |
| Event              | Eigene Bilder in eigenem Takt für eine bestimmte Zeit (Geburtstag, Fest).                                                   | Anlass, Modus                   |
| Verlauf            | Was geändert, übertragen und zurückgemeldet wurde.                                                                          | Log, Historie                   |
| Zugänge            | Schlüssel für Immich und andere Dienste.                                                                                    | Secrets, API-Keys               |
| Schlüssel          | Ein Zugangsschlüssel für einen Dienst.                                                                                      | Token, Key                      |
| Geräte-PIN         | Die PIN des Rahmens aus der Samsung-App. Immer „die PIN“.                                                                   | Passwort, der PIN               |
| Erkennungsbild     | Karte mit Name, Gerät, IP, Gruppe und „▲ OBEN“, die zeigt, welcher Rahmen das ist.                                          | ID-Karte                        |
| Testbild           | Karte mit Farbbalken zum Prüfen von Ausrichtung, Farben und Schärfe.                                                        | Testpattern                     |

## Formate

| Wort                    | Bedeutung                                                  | nicht               |
| ----------------------- | ---------------------------------------------------------- | ------------------- |
| Hochformat / Querformat | Wie ein Rahmen hängt und in welchem Stapel ein Bild liegt. | Portrait, Landscape |
| Zuschnitt               | Der Ausschnitt eines Bildes in der Form des Rahmens.       | Crop                |
| Vorschlag               | Der automatische Zuschnitt.                                | Auto-Crop           |

## Zeit und Strom

| Wort                         | Bedeutung                                                                   | nicht                            |
| ---------------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| Wechsel                      | Der Rahmen zeigt ein neues Bild.                                            | Update, Refresh                  |
| Wechselrhythmus              | Wie oft ein Rahmen normalerweise wechselt („täglich um 07:00“).             | Kadenz, Intervall                |
| Takt                         | Wie oft während eines Events gewechselt wird.                               | Kadenz                           |
| Bildaufbau                   | Der Rahmen baut ein Bild auf. Das ist es, was Akku kostet.                  | Refresh, Redraw                  |
| Akku                         | Rahmen mit Akku: schläft zwischen den Wechseln.                             | Batterie                         |
| Dauerstrom                   | Rahmen am Netzteil: immer erreichbar, Änderungen gehen sofort raus.         | Netzbetrieb, Modus               |
| lädt gerade                  | Akku-Rahmen am Ladegerät: so lange erreichbar wie einer am Strom.           |                                  |
| reicht voraussichtlich bis … | Schätzung, wie lange der Akku beim jetzigen Rhythmus hält.                  | Restlaufzeit                     |
| Tiefschlaf                   | Der Rahmen schläft und ist nicht im WLAN. Der Normalzustand.                | Deep Sleep, Standby              |
| Leichter Schlaf              | Der Rahmen schläft, hängt aber noch im WLAN. Kostet Akku.                   | Light Sleep                      |
| sich melden                  | Der Rahmen ist kurz erreichbar: nach einem Wechsel oder nach Knopfdruck.    | online kommen, aufwachen         |
| Knopf am Rahmen              | Der Einschaltknopf. Ein Druck weckt den Rahmen für etwa anderthalb Minuten. | Power-Button                     |
| Reinigung des Bildschirms    | Das tägliche Auffrischen des Bildschirms.                                   | Panel Cleaning, Bildschirmschutz |

## Änderungen

Alles, was einen Rahmen betrifft, ist eine **Änderung**. Sie durchläuft immer dieselben Stufen:

| Wort                | Bedeutung                                        |
| ------------------- | ------------------------------------------------ |
| eingestellt         | Hier gespeichert, noch nichts gesendet.          |
| wartet auf Rahmen   | Der Server hält nach dem Rahmen Ausschau.        |
| übertragen          | Beim Rahmen angekommen, noch nicht bestätigt.    |
| am Rahmen bestätigt | Der Rahmen hat es selbst zurückgemeldet.         |
| abweichend          | Der Rahmen meldet etwas anderes als eingestellt. |

Nie „gesendet“ oder „wird gezeigt“ sagen, bevor der Rahmen bestätigt hat. Bei Rahmen am Strom oder am Ladegerät heißt es „geht sofort raus“ oder „geht gerade raus“, nicht „wartet“: auch im Zeitplan und in der Hilfe.

Davor gibt es noch **noch nicht gespeichert**: auf der Seite geändert, aber nicht gespeichert, also noch keine Änderung. Dieselben vier Punkte, alle leer. Unter einem solchen Feld steht nie das grüne „am Rahmen bestätigt“ allein, sondern der Wert, den der Rahmen wirklich bestätigt hat: „Am Rahmen bestätigt: täglich um 07:00“.

Im Verlauf steht zu jeder Änderung, was sich geändert hat, mit den Werten: „Reinigungszeit von 05:50 auf 06:50“. Die Stufe steht als dieselben vier Punkte daneben. Einstellen, Übertragung und Bestätigung gehören zusammen: „Alle Schritte dieser Änderung“ zeigt sie untereinander.

## Zustände eines Bildes

| Wort                    | Bedeutung                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| im Stapel               | Frei, kann als Nächstes gezogen werden. Nur für Bilder, deren Album eine Gruppe zeigt.                                                                                                                                                                  |
| keine Gruppe            | In der Bibliothek, aber in keinem Stapel: keine Gruppe zeigt eines seiner Alben.                                                                                                                                                                        |
| vorgemerkt              | Für einen Rahmen reserviert oder schon dort im Vorrat.                                                                                                                                                                                                  |
| hängt gerade            | Ist auf einem Rahmen zu sehen.                                                                                                                                                                                                                          |
| gezeigt in dieser Runde | War in dieser Runde schon dran. Kommt wieder, wenn der Stapel durch ist und neu gemischt wird; was zuletzt hing, kommt dabei nach hinten.                                                                                                               |
| hing eben erst          | Hat gerade erst einen Rahmen verlassen. Von selbst bekommt es so bald kein zweiter Rahmen; „Zeigen“ warnt. Eine Zahl von Tagen gibt es dafür in der Oberfläche nicht.                                                                                   |
| pausiert                | Bleibt in der Bibliothek, kommt auf keinen Rahmen.                                                                                                                                                                                                      |
| wahrscheinlich          | Der Server sieht den Bildschirm nicht; gestreifte Bilder sind nicht sicher.                                                                                                                                                                             |
| mit gesperrt            | Ein kombiniertes Bild und seine Bilder sperren sich gegenseitig. Nur eines hat den Platz am Rahmen; die anderen sind „wegen eines enthaltenen Bildes“ oder „wegen des kombinierten Bildes“ gesperrt und brauchen keinen zusätzlichen Platz im Zeitplan. |
| noch kein Bild von hier | Ein neuer Rahmen, der noch nichts bekommen hat. Was er zeigt, ist offen, bis er sein Erkennungsbild bestätigt.                                                                                                                                          |

## Tätigkeiten

Ein Knopf heißt so wie das, was er tut, und die Rückmeldung benutzt dasselbe Wort.

| Wort                               | Bedeutung                                                                                                                                                                                                                                                                                   | nicht                                                    |
| ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Zeigen                             | Ein Bild auf einen Rahmen bringen. Immer mit Wann und Wo.                                                                                                                                                                                                                                   | Senden, Pushen                                           |
| Jetzt                              | So früh wie möglich: gleich nach der nächsten Meldung des Rahmens; kostet bei Akku einen zusätzlichen Bildaufbau.                                                                                                                                                                           | Sofort senden                                            |
| Als Nächstes                       | Beim regulären Wechsel nach der nächsten Meldung des Rahmens. Ein schlafender Rahmen wechselt erst zu dem Bild, das er schon hat, und meldet sich danach: das neue Bild ist einen Wechsel später zu sehen. Am Strom oder am Ladegerät: beim nächsten Wechsel. Kein zusätzlicher Bildaufbau. | Einreihen, beim nächsten Wechsel (für schlafende Rahmen) |
| Auf diesem Rahmen / Im ganzen Haus | Wohin „Zeigen“ geht.                                                                                                                                                                                                                                                                        |                                                          |
| Trotzdem zeigen                    | Bewusst zeigen, obwohl das Bild doppelt zu sehen wäre.                                                                                                                                                                                                                                      | Erzwingen                                                |
| Übernehmen                         | Ein Bild aus dem Eingang in die Bibliothek nehmen.                                                                                                                                                                                                                                          | Akzeptieren, Importieren                                 |
| Wiederherstellen                   | Ein verworfenes Bild zurück in den Eingang legen. Geht 30 Tage lang, unter Eingang, „Verworfen“.                                                                                                                                                                                            | Rückgängig                                               |
| Verwerfen                          | Ein Bild im Eingang nicht nehmen.                                                                                                                                                                                                                                                           | Ablehnen                                                 |
| Bearbeiten                         | Zuschnitt, Format, Alben ändern.                                                                                                                                                                                                                                                            | Editieren                                                |
| Pausieren / Fortsetzen             | Aus dem Stapel nehmen / zurücklegen, ohne zu löschen.                                                                                                                                                                                                                                       | Deaktivieren                                             |
| Löschen                            | Endgültig weg. Wird als Einziges nachgefragt (wie Entfernen und Beenden).                                                                                                                                                                                                                   |                                                          |
| Zurücknehmen                       | Eine Änderung widerrufen, solange sie nicht am Rahmen ist.                                                                                                                                                                                                                                  | Rückgängig, Abbrechen                                    |
| Korrigieren                        | Eine Änderung, die schon übertragen ist, durch eine neue Änderung ersetzen.                                                                                                                                                                                                                 | Rückgängig                                               |
| In den Eingang holen               | Gewählte Bilder aus Immich oder Werke aus dem Kunstkatalog in den Eingang kopieren.                                                                                                                                                                                                         | Importieren                                              |
| Aus Immich holen                   | Bilder aus Immich in den Eingang kopieren.                                                                                                                                                                                                                                                  | Importieren, Synchronisieren                             |
| Abonnieren                         | Ein Immich-Album beobachten; neue Bilder landen im Eingang.                                                                                                                                                                                                                                 | Sync                                                     |
| Testen                             | Prüfen, ob ein Schlüssel funktioniert.                                                                                                                                                                                                                                                      | Validieren                                               |
| Kombinieren                        | Aus mehreren Bildern ein kombiniertes Bild machen.                                                                                                                                                                                                                                          | Paaren                                                   |

## Übersicht

| Wort         | Bedeutung                                                                                                                                                         | nicht                |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| Jetzt        | Ansicht der Übersicht: jeder Rahmen mit dem Bild, das gerade hängt.                                                                                               | Aktuell, Live        |
| Als Nächstes | Ansicht der Übersicht: jeder Rahmen mit dem kommenden Bild und dem, was zu ihm unterwegs ist. (Auch: das „Wann“ beim Zeigen.)                                     | Geplant, Vorschau    |
| unterwegs    | Eine Änderung, die der Rahmen noch nicht bestätigt hat: sie wartet oder geht gerade raus.                                                                         | pending, in Arbeit   |
| Braucht dich | Der schmale Streifen oben: nur was wirklich zu tun ist, je eine Zeile.                                                                                            | Warnungen, Meldungen |
| Zeichen      | Die kleinen Marken unter einem Rahmen: Akku, lädt, am Strom, Wechsel verpasst, weicht ab (≠), Vorrat aufgebraucht, Änderungen warten, Event, gerade aktualisiert. | Badge, Status-Icon   |

## Ton

Du-Form, kurze Sätze, Alltagswörter. Vor jeder Tat steht, was passiert und wann: „Flur zeigt dieses Bild ab Sa 06:00, oder sofort per Knopf. Kostet einen zusätzlichen Bildaufbau.“ Zeiten immer mit 24 Stunden, auch in einem englisch eingestellten Browser: „heute 07:00“, „morgen 06:00“, „Sa 06:00“, weiter weg „Sa 28.11., 06:00“. Fehler sagen, was los ist und was hilft, ohne Entschuldigung.
