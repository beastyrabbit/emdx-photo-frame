import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { toast } from "sonner"
import { api } from "./index"
import type { ArtPage, ArtQuery, ImmichQuery, Orientation, PhotoQuery } from "./types"

// Live data is asked for again every few seconds, like today's status page does.
const LIVE = { refetchInterval: 4000 }

export const useOverview = () => useQuery({ queryKey: ["overview"], queryFn: api.getOverview, ...LIVE })
export const useFrame = (id: string) => useQuery({ queryKey: ["frame", id], queryFn: () => api.getFrame(id), ...LIVE })
export const usePending = (frameId?: string) => useQuery({ queryKey: ["pending", frameId ?? "alle"], queryFn: () => api.listPending(frameId), ...LIVE })
export const useGroups = () => useQuery({ queryKey: ["groups"], queryFn: api.listGroups })
export const useDeck = (groupId: string, orientation: Orientation) =>
  useQuery({ queryKey: ["deck", groupId, orientation], queryFn: () => api.getDeck(groupId, orientation) })
// The timeline says how far a new order has got, so it is kept as fresh as the pending changes.
export const useTimeline = (frameId: string) =>
  useQuery({ queryKey: ["timeline", frameId], queryFn: () => api.getTimeline(frameId), enabled: !!frameId, ...LIVE })
export const usePictures = () => useQuery({ queryKey: ["pictures"], queryFn: api.listPictures })
export const usePicture = (id: string) => useQuery({ queryKey: ["picture", id], queryFn: () => api.getPicture(id), enabled: !!id })
export const useAlbums = () => useQuery({ queryKey: ["albums"], queryFn: api.listAlbums })
export const useInbox = () => useQuery({ queryKey: ["inbox"], queryFn: api.listInbox })
export const useDiscarded = () => useQuery({ queryKey: ["discarded"], queryFn: api.listDiscarded })
export const useEvents = () => useQuery({ queryKey: ["events"], queryFn: api.listEvents })
export const useImmich = () => useQuery({ queryKey: ["immich"], queryFn: api.getImmich })
export const useImmichSearch = (query: ImmichQuery) =>
  useQuery({ queryKey: ["immich-search", query], queryFn: () => api.searchImmich(query), placeholderData: (prev) => prev })
// Works and photos come a page at a time; "Mehr laden" asks for the next.
const pages = <Q extends { cursor?: string | null }>(key: string, query: Q, fn: (q: Q) => Promise<ArtPage>, enabled: boolean) =>
  useInfiniteQuery({
    queryKey: [key, query],
    queryFn: ({ pageParam }) => fn({ ...query, cursor: pageParam }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: ArtPage) => last.next,
    placeholderData: (prev) => prev,
    enabled,
  })
export const useArtSearch = (query: ArtQuery, enabled = true) => pages("art-search", query, api.searchArt, enabled)
export const usePhotoSearch = (query: PhotoQuery, enabled = true) => pages("photo-search", query, api.searchPhotos, enabled)
export const useSettings = () => useQuery({ queryKey: ["settings"], queryFn: api.getSettings })
export const useKeys = () => useQuery({ queryKey: ["keys"], queryFn: api.listKeys })
export const useHistory = (frameId?: string) => useQuery({ queryKey: ["history", frameId ?? "alle"], queryFn: () => api.listHistory(frameId), ...LIVE })

/**
 * Runs one change and then asks for everything again, because one change
 * (showing a picture, say) touches frames, decks, pending changes and the history.
 */
export function useAct<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>, done?: string | ((result: TResult, args: TArgs) => string | undefined)) {
  const client = useQueryClient()
  return useMutation({
    mutationFn: fn,
    onSuccess: (result, args) => {
      client.invalidateQueries()
      const text = typeof done === "function" ? done(result, args) : done
      if (text) toast.success(text)
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt")
    },
  })
}

/**
 * "Verwerfen" in the Eingang. The picture is kept for a while, so the message offers the way back
 * and names the picture; several at once are counted.
 */
export function useDiscardInbox() {
  const client = useQueryClient()
  const restore = (ids: string[], text: string) =>
    api.restoreInbox(ids).then(
      () => {
        client.invalidateQueries()
        toast.success(text)
      },
      (error) => toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt"),
    )
  return useMutation({
    mutationFn: (items: { id: string; title: string }[]) => api.discardInbox(items.map((i) => i.id)),
    onSuccess: (_result, items) => {
      client.invalidateQueries()
      const one = items.length === 1
      toast(one ? `„${items[0].title}“ verworfen.` : `${items.length} Bilder verworfen.`, {
        duration: 10_000,
        action: {
          label: "Wiederherstellen",
          onClick: () =>
            restore(
              items.map((i) => i.id),
              one ? `„${items[0].title}“ wiederhergestellt: liegt wieder im Eingang` : `${items.length} Bilder wiederhergestellt: liegen wieder im Eingang`,
            ),
        },
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Das hat nicht geklappt")
    },
  })
}
