import { ParallaxComponent } from '@/components/ui/parallax-scrolling';

export default function ParallaxDemo() {
  return (
    <>
      <ParallaxComponent />
      <div className="text-center py-4 text-xs text-muted-foreground bg-background border-t border-border">
        <p>
          Resource concept by{' '}
          <a
            target="_blank"
            rel="noreferrer"
            href="https://www.osmo.supply/"
            className="text-primary hover:underline font-medium"
          >
            Osmo
          </a>
        </p>
      </div>
    </>
  );
}
