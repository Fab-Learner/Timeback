// Maps HTTP routes onto service calls. Errors are thrown as HttpError by the service.
export function createApi(service) {
  const routes = [
    ['GET', /^\/api\/content$/, () => service.publicContent()],
    ['GET', /^\/api\/students$/, () => service.listStudents()],
    ['POST', /^\/api\/students$/, (_, body) => service.createStudent(body ?? {})],
    ['GET', /^\/api\/students\/(\d+)\/next$/, ([id]) => service.nextFor(Number(id))],
    ['GET', /^\/api\/students\/(\d+)\/report$/, ([id]) => service.report(Number(id))],
    ['POST', /^\/api\/students\/(\d+)\/sessions$/, ([id]) => service.startSession(Number(id))],
    ['POST', /^\/api\/sessions\/(\d+)\/heartbeat$/, ([id], body) => service.heartbeat(Number(id), body ?? {})],
    ['POST', /^\/api\/sessions\/(\d+)\/complete$/, ([id], body) => service.complete(Number(id), body?.activityId)],
    ['POST', /^\/api\/sessions\/(\d+)\/answer$/, ([id], body) => service.answer(Number(id), body ?? {})],
    ['POST', /^\/api\/sessions\/(\d+)\/end$/, ([id]) => service.endSession(Number(id))],
    ['GET', /^\/api\/guide\/roster$/, () => service.roster()],
  ];

  return async function handle(method, pathname, body) {
    for (const [verb, pattern, fn] of routes) {
      const match = pattern.exec(pathname);
      if (verb === method && match) {
        return { status: 200, body: await fn(match.slice(1), body) };
      }
    }
    return { status: 404, body: { error: 'not found' } };
  };
}
