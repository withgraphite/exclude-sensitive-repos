# exclude-sensitive-repos

This action helps manage GitHub app installation repository access.

Specifically, the action takes a series of tokens (allowing it to call the relevant GitHub APIs), a list of owner (GitHub organizations or users) information, and a list of app installation IDs.

For each GitHub owner, the action:

- Scans the total list of owner repositories
- Removes any repository from the app installation that has the 'sensitive' custom_property set to true
- Adds any repository to the app installation that has the 'sensitive' custom_property set to false or undefined
