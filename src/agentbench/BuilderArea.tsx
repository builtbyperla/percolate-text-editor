import { JSX, Component, Show, For, Setter, Accessor, createSignal} from "solid-js";
import { ViewBlock } from "../containers/Tabs";
import style from "../styles/AgentBench.module.css"

const BuildUserPrompt: Component = () => {
    return (
    <div>
        What are we building?
    </div>
    );
}

class EditableField {
    fieldName: string;

    getValue: Accessor<string>;
    setValue: Setter<string>;

    getIsEditMode: Accessor<boolean>;
    setIsEditMode: Setter<boolean>;

    constructor(name: string, value: string) {
        this.fieldName = name;
        [this.getValue, this.setValue] = createSignal(value);
        [this.getIsEditMode, this.setIsEditMode] = createSignal(false);
    }

    onClick(_e: MouseEvent) {
        this.setIsEditMode(true);
    }

    get getEditVisual() {
        return () => (
            <input
                class={style.input}
                inputMode="text"
                value={this.getValue()}
                size={Math.max(this.getValue().length, 1)}
                ref={(el) => queueMicrotask(() => el.focus())}
                onInput={(e) => {
                    e.currentTarget.size = Math.max(e.currentTarget.value.length, 1);
                    this.setValue(e.currentTarget.value);
                }}
                onBlur={() => this.setIsEditMode(false)}
            />
        );
    }

    get getReadVisual() {
        return () => (
            <div class={style.value}
                onclick={(e) => this.onClick(e)}
                >
                {this.getValue()}
                <svg
                    class={style.pencil}
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
            </div>
        );
    }

    getVisual() {
        return () => (
            <div class={style.editline}>
                <div class={style.label}>{this.fieldName}</div>
                {this.getIsEditMode() ? this.getEditVisual() : this.getReadVisual()}
            </div>
        );
    }
}

class SubagentCreateView {
    getValueObjects: Accessor<EditableField[]>;
    setValueObjects: Setter<EditableField[]>;

    constructor(keys: string[], values: string[]) {
        let objects = this._initValues(keys, values);
        [this.getValueObjects, this.setValueObjects] = createSignal(objects);
    }

    _initValues(keys: string[], values: string[]): EditableField[] {
        let objects: EditableField[] = [];
        for (let i = 0; i < keys.length; i++) {
            const object: EditableField = new EditableField(keys[i], values[i]);
            objects.push(object);
        }
        return objects;
    }

    getVisual() {
        return () => (<div class={style.fields}>
            <For each={this.getValueObjects()}>
                {(value) => value.getVisual()()}
            </For>
        </div>
        );
    }
}

export class BuilderArea implements ViewBlock {
    ownsScroll: boolean = false;

    getShowModify: Accessor<boolean>;
    setShowModify: Setter<boolean>;

    constructor() {
        [this.getShowModify, this.setShowModify] = createSignal(true);
    }

    getVisual(): () => JSX.Element {
        let keys = ["agent", "model", "prompt", "attachments"];
        let values = ["ui-builder", "standard", "Build the frontend where each row has...", "frontend.tsx"];
        let subagentSelect = new SubagentCreateView(keys, values);
        return () => (
            <div style="test">
                <Show when={this.getShowModify()} fallback={<BuildUserPrompt></BuildUserPrompt>}>
                    {subagentSelect.getVisual()()}
                </Show>
            </div>
        );
    }
}