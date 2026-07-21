/** Types for the plain-JS redirect worker so tests import it strictly. */
declare const worker: {
  fetch(request: Request): Response;
};
export default worker;
