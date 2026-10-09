class IdService {
    requestId(): string {
        return crypto.randomUUID();
    }
}

export const idService = new IdService();
