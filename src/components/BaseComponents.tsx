import { Accessor, Component, JSX, Setter, createSignal } from 'solid-js';
import { idService } from '../IdService';
import { ViewBlock } from '../containers/Tabs';

export type SelectionType = 'block' | 'segment';

export type LiveData = { [key: string]: any };

export class LiveBaseComponent {
    id: string;
    visualObj: Component<any> | null;

    // ViewBlock contract: live components flow inside a scroll host, so they
    // never own their own scroll, and a live block is never structurally empty.
    ownsScroll: boolean = false;

    getFrameEl: Accessor<HTMLElement | undefined>;
    setFrameEl: Setter<HTMLElement | undefined>;

    constructor() {
        this.id = idService.requestId();
        this.visualObj = null;
        [this.getFrameEl, this.setFrameEl] = createSignal<HTMLElement | undefined>(undefined);
    }

    getCoreVisual(): () => JSX.Element {
        return () => (<br>"Missing component"</br>);
    }

    getPreviewText() {
        return '';
    }
}

export class LiveComponent extends LiveBaseComponent implements ViewBlock {
    data: LiveData;

    constructor(data: LiveData) {
        super();
        this.data = data;
        this.visualObj = null;
    }

    getVisual(): () => JSX.Element {
        return this.getCoreVisual();
    }
}
