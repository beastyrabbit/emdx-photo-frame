import { Link } from "react-router"
import { PageHead } from "@/components/bits"
import { BadgeLegend } from "@/components/frame-badges"
import { ConfirmMark, StateMark } from "@/components/marks"
import { ArtImage, FrameObject } from "@/components/picture"

function Topic({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid max-w-[62ch] gap-2 border-t border-line pt-5">
      <h2>{title}</h2>
      {children}
    </section>
  )
}

export function HelpScreen() {
  return (
    <div className="grid gap-6">
      <PageHead title="So funktioniert's" lead="Das Wichtigste in zwei Minuten." />

      <Topic title="Ein Rahmen schläft fast immer">
        <p>
          Die Rahmen laufen mit Akku. Um Strom zu sparen, schlafen sie und sind dann nicht erreichbar. Wach werden sie nur kurz: wenn sie ihr Bild wechseln,
          oder wenn jemand den Knopf am Rahmen drückt.
        </p>
        <p>Ein Rahmen am Strom oder am Ladegerät schläft nicht: er ist immer erreichbar.</p>
      </Topic>

      <Topic title="Wann eine Änderung ankommt">
        <p>
          Bei schlafenden Akku-Rahmen warten Änderungen bis zur nächsten Meldung. Dann kommt alles zusammen an. Die Seite sagt dir vorher, wann das
          voraussichtlich ist, und bis dahin kannst du jede Änderung zurücknehmen.
        </p>
        <p>Am Strom oder am Ladegerät gehen Änderungen sofort raus. Zurücknehmen lässt sich dort kaum etwas; du korrigierst mit einer neuen Änderung.</p>
        <ul className="m-0 grid list-none gap-2 p-0">
          <li>
            <ConfirmMark state="eingestellt" /> <span className="text-[15px] text-ink-soft">Du hast es hier gespeichert.</span>
          </li>
          <li>
            <ConfirmMark state="wartet" /> <span className="text-[15px] text-ink-soft">Der Server hält nach dem Rahmen Ausschau.</span>
          </li>
          <li>
            <ConfirmMark state="uebertragen" /> <span className="text-[15px] text-ink-soft">Es ist beim Rahmen angekommen.</span>
          </li>
          <li>
            <ConfirmMark state="bestaetigt" /> <span className="text-[15px] text-ink-soft">Der Rahmen hat es selbst zurückgemeldet.</span>
          </li>
          <li>
            <ConfirmMark state="abweichend" /> <span className="text-[15px] text-ink-soft">Der Rahmen meldet etwas anderes. Du entscheidest, was gilt.</span>
          </li>
        </ul>
        <p>Eilig bei einem schlafenden Rahmen? Ein Druck auf seinen Knopf, und nach ein paar Sekunden ist alles da.</p>
      </Topic>

      <Topic title="Jetzt oder als Nächstes">
        <p>
          <strong>Als Nächstes</strong> stellt ein Bild nach vorn, ohne zusätzlichen Bildaufbau. Ein schlafender Rahmen wechselt aber erst zu dem Bild, das er
          schon hat, und meldet sich danach. Dein Bild ist deshalb beim regulären Wechsel nach dieser Meldung zu sehen, also einen Wechsel später. Bei einem
          Rahmen am Strom ist es gleich der nächste Wechsel.
        </p>
        <p>
          <strong>Jetzt</strong> zeigt es so früh wie möglich: sobald sich der Rahmen meldet. Der Rahmen baut dafür einmal zusätzlich ein Bild auf, das kostet
          etwas Akku.
        </p>
      </Topic>

      <Topic title="Gestreift heißt: nicht sicher">
        <div className="flex items-start gap-4">
          <FrameObject orientation="hoch" unsure className="w-[72px]">
            <ArtImage art={{ motif: "familie1", variant: 0 }} />
          </FrameObject>
          <p>
            Der Server kann den Bildschirm nicht sehen. Er weiß nur, ob sich ein Rahmen nach einem Wechsel gemeldet hat. Meldet er sich nicht, ist das Bild hier
            gestreift: es hängt wahrscheinlich noch, sicher ist das nicht.
          </p>
        </div>
      </Topic>

      <Topic title="Kein Bild hängt doppelt">
        <p>
          Jede <Link to="/gruppen">Gruppe</Link> hat einen gemischten Stapel pro Format. Braucht ein Rahmen Bilder, zieht er die obersten Karten. Ein Bild kommt
          erst wieder dran, wenn der ganze Stapel durch ist. Dann wird neu gemischt, und was zuletzt hing, kommt nach hinten.
        </p>
        <p>
          Gehört ein Bild zu mehreren Gruppen, bekommt es kein zweiter Rahmen, solange es woanders hängt oder vorgemerkt ist, und auch nicht gleich danach.
          Einstellen musst du dafür nichts.
        </p>
        <p>
          Willst du ein Bild doch doppelt sehen, warnt dich „Zeigen“ vorher: es hängt gerade, ist vorgemerkt oder hing eben erst. Mit „Trotzdem zeigen“ kannst
          du eine Ausnahme zulassen: sie gilt nur für dieses eine Mal.
        </p>
        <p>Jeder Rahmen hat ein paar Bilder auf Vorrat. So wechselt er weiter, auch wenn der Server einmal nicht erreichbar ist.</p>
      </Topic>

      <Topic title="Neue Bilder kommen in den Eingang">
        <p>
          Hochgeladene Bilder und Bilder aus Immich landen zuerst im <Link to="/bibliothek?ansicht=eingang">Eingang</Link>. Format und Zuschnitt sind dann schon
          vorbereitet. Erst wenn du ein Bild übernimmst, kommt es in die Bibliothek. In einen Stapel kommt es, wenn eine Gruppe sein Album zeigt.
        </p>
        <p>
          Was du verwirfst, ist nicht gleich weg: es liegt noch 30 Tage unter <Link to="/bibliothek?ansicht=eingang&eingang=verworfen">Eingang, Verworfen</Link>{" "}
          und lässt sich von dort wiederherstellen.
        </p>
      </Topic>

      <Topic title="Kunst aus dem Katalog">
        <p>
          Schaltest du in den <Link to="/einstellungen">Einstellungen</Link> den Kunstkatalog ein, erscheint der Bereich „Kunst“. Dort suchst du gemeinfreie
          Werke aus Wikimedia Commons, dem Metropolitan Museum of Art und dem Art Institute of Chicago. Was du auswählst, landet im Eingang wie jedes andere
          neue Bild.
        </p>
        <p>
          Jede Gruppe kann Kunst untermischen: dann ist jedes 3., 5. oder 10. Bild ihrer Stapel ein Kunstwerk, aus deinen übernommenen Werken oder aus der
          Auswahl des Katalogs.
        </p>
      </Topic>

      <Topic title="Die Zeichen">
        <ul className="m-0 grid list-none gap-2 p-0">
          <li>
            <StateMark level="ok">Alles in Ordnung</StateMark>
          </li>
          <li>
            <StateMark level="warn">Bald darum kümmern</StateMark> <span className="text-[15px] text-ink-soft">zum Beispiel Akku unter 20 %</span>
          </li>
          <li>
            <StateMark level="bad">Braucht dich jetzt</StateMark> <span className="text-[15px] text-ink-soft">zum Beispiel Wechsel verpasst</span>
          </li>
          <li>
            <StateMark level="wait">Wartet auf den Rahmen</StateMark> <span className="text-[15px] text-ink-soft">oder geht gerade raus</span>
          </li>
        </ul>
        <p className="text-[15px] text-ink-soft">Blau ist außerdem alles, was du antippen kannst.</p>
        <p>
          In der <Link to="/">Übersicht</Link> trägt jeder Rahmen seine Zeichen unter dem Bild. Dieselben Farben, kleiner:
        </p>
        <BadgeLegend className="text-[15px]" />
        <p>Oben in der Übersicht schaltest du um: „Jetzt“ zeigt, was hängt, „Als Nächstes“ das kommende Bild je Rahmen und was noch zu ihm unterwegs ist.</p>
      </Topic>
    </div>
  )
}
