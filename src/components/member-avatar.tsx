import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { cn } from "@/lib/utils"
import type { SourceView } from "@/server/queries"

const PARTY: Record<string, { label: string; className: string }> = {
  D: { label: "D", className: "bg-[#2f5aa8] text-white" },
  R: { label: "R", className: "bg-[#b0382c] text-white" },
  I: { label: "I", className: "bg-muted-foreground text-background" },
}

function initials(name: string) {
  const parts = name.split(/\s+/).filter((p) => /^[A-Z]/.test(p))
  return (parts[0]?.[0] ?? "") + (parts.at(-1)?.[0] ?? "")
}

export function MemberAvatar({ source, className }: { source: SourceView; className?: string }) {
  return (
    <Avatar className={cn("size-10 rounded-none", className)}>
      {source.photoUrl && <AvatarImage src={source.photoUrl} alt="" className="object-cover object-top" />}
      <AvatarFallback className="rounded-none text-xs">{initials(source.name)}</AvatarFallback>
    </Avatar>
  )
}

export function PartySeat({ source }: { source: SourceView }) {
  if (source.kind === "insider") {
    return (
      <span className="inline-flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
        <span className="border px-1 font-mono text-[10px] font-bold text-foreground">{source.seat}</span>
        <span className="truncate">{source.affiliation}</span>
      </span>
    )
  }
  const party = source.affiliation ? PARTY[source.affiliation] : null
  const seat = source.seat ? `${source.seat.slice(0, 2)}-${Number(source.seat.slice(2)) || "AL"}` : null
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      {party && (
        <span className={cn("inline-flex size-4 items-center justify-center font-mono text-[10px] font-bold", party.className)}>
          {party.label}
        </span>
      )}
      {seat}
    </span>
  )
}
