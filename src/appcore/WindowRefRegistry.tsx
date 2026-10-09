import { Accessor } from "solid-js";

class WindowRefRegistry {
    map: Map<string, Accessor<HTMLElement | undefined>> = new Map<string, Accessor<HTMLElement|undefined>>([]);

    register(key: string, refAccessor: Accessor<HTMLElement|undefined>) {
        this.map.set(key, refAccessor);
    }
}

export const windowrefregistry = new WindowRefRegistry();