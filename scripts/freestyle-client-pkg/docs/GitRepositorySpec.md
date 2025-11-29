# GitRepositorySpec


## Properties

Name | Type | Description | Notes
------------ | ------------- | ------------- | -------------
**repo** | **str** | url or id of the git repository | 
**path** | **str** | path to place the repo on | 
**rev** | **str** | optional rev (branch, tag, commit) | [optional] 

## Example

```python
from freestyle_client.models.git_repository_spec import GitRepositorySpec

# TODO update the JSON string below
json = "{}"
# create an instance of GitRepositorySpec from a JSON string
git_repository_spec_instance = GitRepositorySpec.from_json(json)
# print the JSON string representation of the object
print(GitRepositorySpec.to_json())

# convert the object into a dict
git_repository_spec_dict = git_repository_spec_instance.to_dict()
# create an instance of GitRepositorySpec from a dict
git_repository_spec_from_dict = GitRepositorySpec.from_dict(git_repository_spec_dict)
```
[[Back to Model list]](../README.md#documentation-for-models) [[Back to API list]](../README.md#documentation-for-api-endpoints) [[Back to README]](../README.md)


