import { Package } from "lucide-react";

// Plain <img>: product images come from Amazon's CDN in many sizes, so next/image adds little here.
export function ProductThumb({ src, size = 44 }: { src: string | null; size?: number }) {
  return (
    <div
      className="grid shrink-0 place-items-center overflow-hidden rounded-lg border border-line bg-white"
      style={{ width: size, height: size }}
    >
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-contain" />
      ) : (
        <Package className="size-1/2 text-muted-foreground" />
      )}
    </div>
  );
}
