import { Disposable, IReference } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { ITextModel } from '../../../../editor/common/model.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ITextFileService } from '../../../services/textfile/common/textfiles.js';

type SenweaverModelType = {
	model: ITextModel | null;
	editorModel: IResolvedTextEditorModel | null;
};

export interface ISenweaverModelService {
	readonly _serviceBrand: undefined;
	initializeModel(uri: URI): Promise<void>;
	getModel(uri: URI): SenweaverModelType;
	getModelFromFsPath(fsPath: string): SenweaverModelType;
	getModelSafe(uri: URI): Promise<SenweaverModelType>;
	saveModel(uri: URI): Promise<void>;

}

export const ISenweaverModelService = createDecorator<ISenweaverModelService>('senweaverModelService');

class SenweaverModelService extends Disposable implements ISenweaverModelService {
	_serviceBrand: undefined;
	static readonly ID = 'senweaverModelService';
	private readonly _modelRefOfURI: Record<string, IReference<IResolvedTextEditorModel>> = {};

	constructor(
		@ITextModelService private readonly _textModelService: ITextModelService,
		@ITextFileService private readonly _textFileService: ITextFileService,
	) {
		super();
	}

	saveModel = async (uri: URI) => {
		await this._textFileService.save(uri, { // we want [our change] -> [save] so it's all treated as one change.
			skipSaveParticipants: true // avoid triggering extensions etc (if they reformat the page, it will add another item to the undo stack)
		})
	}

	initializeModel = async (uri: URI) => {
		try {
			if (uri.fsPath in this._modelRefOfURI) return;
			const editorModelRef = await this._textModelService.createModelReference(uri);
			// Keep a strong reference to prevent disposal
			this._modelRefOfURI[uri.fsPath] = editorModelRef;
		}
		catch (e) {
			console.log('InitializeModel error:', e)
		}
	};

	getModelFromFsPath = (fsPath: string): SenweaverModelType => {
		const editorModelRef = this._modelRefOfURI[fsPath];
		if (!editorModelRef) {
			return { model: null, editorModel: null };
		}

		const model = editorModelRef.object.textEditorModel;

		if (!model) {
			return { model: null, editorModel: editorModelRef.object };
		}

		return { model, editorModel: editorModelRef.object };
	};

	getModel = (uri: URI) => {
		return this.getModelFromFsPath(uri.fsPath)
	}


	getModelSafe = async (uri: URI): Promise<SenweaverModelType> => {
		if (!(uri.fsPath in this._modelRefOfURI)) await this.initializeModel(uri);
		return this.getModel(uri);

	};

	override dispose() {
		super.dispose();
		for (const ref of Object.values(this._modelRefOfURI)) {
			ref.dispose(); // release reference to allow disposal
		}
	}
}

registerSingleton(ISenweaverModelService, SenweaverModelService, InstantiationType.Eager);
