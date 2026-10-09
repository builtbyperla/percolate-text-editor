import type { FileSystemProvider } from '../fileexplorer/FileSystemProvider';
import { CmTextDataModel } from './TextDataModel';

export async function saveModel(
    model: CmTextDataModel,
    provider: FileSystemProvider,
    path: string,
): Promise<void> {
    await provider.writeFile(path, model.getValue());
    model.markSaved();
}
