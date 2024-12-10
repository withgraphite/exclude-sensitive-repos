export type Repo = {
  id: number;
  fullName: string;
};

export function sortRepos(a: Repo, b: Repo) {
  if (a.fullName > b.fullName) {
    return 1;
  } else {
    return -1;
  }
}
